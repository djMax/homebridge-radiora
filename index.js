import { EventEmitter } from 'events';
import net from 'net';

// RadioRA2 Platform Shim for HomeBridge
//
// Remember to add platform to config.json. Example:
// 'platforms': [
//     {
//         'platform': 'RadioRA',             // required
//         'name': 'RadioRA',                 // required
//     }
// ],
//
// When you attempt to add a device, it will ask for a 'PIN code'.
// The default code for all HomeBridge accessories is 031-45-154.
//

const MESSAGE_RECEIVED = 'messageReceived';

const priv = Symbol();
let Service;
let Characteristic;

function incomingData(context, str) {
  try {
    if (/GNET>\s/.test(str)) {
      if (!context.loggedIn) {
        context.log('Logged into RadioRA controller');
        context.loggedIn = context.ready = true;
        context.ra.emit('loggedIn', true);
      }
      while (context.commandQueue.length) {
        const msg = context.commandQueue.shift();
        context.socket.write(msg);
      }
      return;
    }
    const m = /^~OUTPUT,(\d+),1,([\d\.]+)/.exec(str);
    if (m) {
      const deviceId = Number(m[1]);
      context.status[deviceId] = context.status[deviceId] || {};
      context.status[deviceId].level = m[2];
      delete context.status[deviceId].inProcess;
      context.ra.emit(MESSAGE_RECEIVED, {
        type: 'status',
        id: deviceId,
        level: m[2],
      });
    }
  } catch (error) {
    context.log(error.message);
  }
}

function sendPassword(context, prompt) {
  if (!/^password:\s*/.test(prompt)) {
    context.log(`Bad login response /${prompt}/`);
    return;
  }
  context.state = incomingData;
  context.socket.write(`${context.config.password}\r\n`);
}

function sendUsername(context, prompt) {
  if (!/^login:\s*/.test(prompt)) {
    context.log(`Bad initial response /${prompt}/`);
    return;
  }
  context.socket.write(`${context.config.username}\r\n`);
  context.state = sendPassword;
}

let dogs = 0;

/**
 * Make sure fn gets called exactly once after no more than maxTime
 */
function watchDog(name, maxTime, context, fn) {
  const start = Date.now();
  dogs++;
  let wasDone = false;
  setTimeout(() => {
    if (!wasDone) {
      wasDone = true;
      dogs--;
      context.log(`${name} watch dog kicked after ${maxTime} (${dogs})`);
      fn();
    }
  }, maxTime);
  return (...cbArgs) => {
    const time = Date.now() - start;
    if (!wasDone) {
      wasDone = true;
      dogs--;
      context.log(`${name} completed in ${time}ms (${dogs})`);
      fn(...cbArgs);
    } else {
      context.log(`${name} callback took too long ${time}ms (${dogs})`);
    }
  };
}

class RadioRAItem {
  constructor(log, item, platform) {
    // device info
    this.name = item.name;
    this.lastBrightness = 100;
    this.model = 'RadioRA';
    this.deviceId = item.id;
    this.serial = item.serial;
    this.isSwitch = item.type === 'switch';
    this.log = log;
    this.platform = platform;
  }

  get(type, callback) {
    switch (type) {
      case 'power':
        this.platform.getDimmer(this.deviceId,
          watchDog('getPower', this.platform[priv].timeout, this.platform[priv],
            (level) => {
              callback(null, !!Number(level));
            }));
        break;
      case 'brightness':
        this.platform.getDimmer(this.deviceId,
          watchDog('getBrightness', this.platform[priv].timeout, this.platform[priv],
            (level) => {
              this.lastBrightness = parseInt(level, 10) || this.lastBrightness;
              callback(null, parseInt(level, 10));
            }));
        break;
      default:
        throw new Error('Invalid Characteristic requested');
    }
  }

  setPower(state, callback) {
    this.platform[priv].log(
      `setPower ${this.deviceId} ${state ? 'on' : 'off'} (${this.lastBrightness}%)`
    );
    this.platform.setDimmer(
      this.deviceId, state ? this.lastBrightness : 0,
      watchDog('setPower', this.platform[priv].timeout, this.platform[priv], () => callback())
    );
  }

  setBrightness(value, callback) {
    this.platform[priv].log(
      `setBrightness ${this.deviceId} ${value}%`
    );
    this.lastBrightness = value || this.lastBrightness;
    this.platform.setDimmer(this.deviceId, value,
      watchDog('setBrightness', this.platform[priv].timeout, this.platform[priv],
        () => {
          if (this.service) {
            this.disablePowerEvent = true;
            this.service
              .getCharacteristic(Characteristic.On)
              .setValue(Number(value) !== 0, undefined, 'fromSetValue');
            this.disablePowerEvent = false;
          }
          callback();
        }));
  }

  getServices() {
    const services = [];
    this.service = new Service.Lightbulb(this.name);
    this.service.RadioRAItem = this;

    // gets and sets over the remote api
    this.service.getCharacteristic(Characteristic.On)
      .on('get', (callback) => { this.get('power', callback); })
      .on('set', (value, callback) => {
        if (!this.disablePowerEvent) {
          this.setPower(value, callback);
        } else {
          callback();
        }
      });

    if (!this.isSwitch) {
      this.service.addCharacteristic(Characteristic.Brightness)
        .on('get', (callback) => { this.get('brightness', callback); })
        .on('set', (value, callback) => { this.setBrightness(value, callback); });
    }

    services.push(this.service);

    const service = new Service.AccessoryInformation();
    service.setCharacteristic(Characteristic.Manufacturer, 'LUTRON')
      .setCharacteristic(Characteristic.Model, this.model)
      .setCharacteristic(Characteristic.SerialNumber, this.serial);
    services.push(service);

    return services;
  }
}

class RadioRA extends EventEmitter {
  constructor(log, config) {
    super();
    this.setMaxListeners(0);
    log('RadioRA Platform Created');
    this[priv] = {
      ra: this,
      config,
      log,
      ready: false,
      loggedIn: false,
      socket: null,
      state: null,
      commandQueue: [],
      responderQueue: [],
      status: {},
      timeout: config.timeout || 4000,
    };
    this.connect();
    module.exports.platforms[config.name || 'default'] = this;
  }

  connect() {
    const p = this[priv];
    p.state = sendUsername;

    p.socket = net.connect(23, this[priv].config.host);
    p.socket.on('data', (data) => {
      // p.log.debug(`RECEIVED ${String(data).replace(/\r\n/g, '<br>')}`);
      const str = String(data);
      const parts = str.split('\r\n');
      for (const line of parts) {
        p.state(p, line);
      }
    }).on('connect', () => {
      p.log('Connected to RadioRA controller');
    }).on('end', () => {
      if (this[priv].loggedIn) {
        p.log('Lost connection to RadioRA controller, reconnecting');
        p.loggedIn = p.ready = false;
        this.connect();
      } else {
        p.log('Connection to RadioRA controller ended');
      }
    });
  }

  disconnect() {
    this[priv].loggedIn = false;
    this[priv].socket.end();
  }

  sendCommand(command) {
    const p = this[priv];
    let toSend = command;
    if (!/\r\n$/.test(toSend)) {
      toSend += '\r\n';
    }
    if (p.ready) {
      // p.log.debug(`Sending ${toSend.replace(/\r\n/g, '')}`);
      p.socket.write(toSend);
    } else {
      p.log.debug('Controller not ready, adding command to queue..');
      p.commandQueue.push(toSend);
    }
  }

  setDimmer(id, level, maybeFade, maybeDelay, maybeCallback) {
    let cb = maybeCallback;
    let delay = maybeDelay;
    let fade = maybeFade;
    if (!cb) { cb = delay; delay = null; }
    if (!cb) { cb = fade; fade = null; }

    const result = (msg) => {
      if (msg.type === 'status' && id === msg.id) {
        if (cb) {
          cb(msg);
        }
        this.removeListener(MESSAGE_RECEIVED, result);
      }
    };
    this.on(MESSAGE_RECEIVED, result);

    // TODO: From map. See Lutron's "OUTPUT: Command Summary" in the integration protocol PDF.
    const action = 1; // Set or Get Zone Level

    let cmd = `#OUTPUT,${id},${action},${level}`;
    if (fade) {
      cmd += `,${fade}`;
      if (delay) {
        cmd += `,${delay}`;
      }
    }
    this.sendCommand(cmd);
  }

  getDimmer(id, callback) {
    const numId = Number(id);
    const p = this[priv];
    p.status[numId] = p.status[numId] || {};
    if (!p.status[numId].inProcess && p.status[numId].level) {
      p.log(`Returning ${p.status[numId].level} from cache`);
      callback(p.status[numId].level);
      return;
    }
    const result = (msg) => {
      if (msg.type === 'status' && numId === msg.id) {
        this.removeListener(MESSAGE_RECEIVED, result);
        callback(parseFloat(msg.level));
      }
    };
    this.on(MESSAGE_RECEIVED, result);
    if (!p.status[numId].inProcess) {
      p.status[numId].inProcess = true;
      const cmd = `?OUTPUT,${numId}`;
      this.sendCommand(cmd);
    } else {
      p.log(`Waiting for existing query for status of ${id}`);
    }
  }

  accessories(callback) {
    this[priv].log('Fetching RadioRA lights from HomeBridge config..');
    const items = [];
    for (let i = 0; i < this[priv].config.lights.length; i++) {
      const rrItem = new RadioRAItem(this.log, this[priv].config.lights[i], this);
      items.push(rrItem);
      this.accessories[this[priv].config.lights[i].id] = rrItem;
    }
    callback(items);
  }
}

function Homebridge(homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;

  homebridge.registerAccessory('homebridge-radiora-item', 'RadioRAItem', RadioRAItem);
  homebridge.registerPlatform('homebridge-radiora', 'RadioRA', RadioRA);
}

Homebridge.accessory = RadioRAItem;
Homebridge.platform = RadioRA;
Homebridge.platforms = {};

module.exports = Homebridge;

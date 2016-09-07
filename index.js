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

function incomingData(context, data) {
  const str = String(data);
  if (/GNET>\s/.test(str)) {
    if (!context.loggedIn) {
      context.log('Logged into RadioRA controller');
      context.loggedIn = context.ready = true;
      context.ra.emit('loggedIn', true);
    }
    if (context.commandQueue.length) {
      const msg = context.commandQueue.shift();
      context.socket.write(msg);
    }
    return;
  }
  const m = /^~OUTPUT,(\d+),1,([\d\.]+)/.exec(str);
  if (m) {
    context.ra.emit(MESSAGE_RECEIVED, {
      type: 'status',
      id: Number(m[1]),
      level: m[2],
    });
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

class RadioRAItem {
  constructor(log, item, platform) {
    // device info
    this.name = item.name;
    this.model = 'RadioRA';
    this.deviceId = item.id;
    this.serial = item.serial;
    this.log = log;
    this.platform = platform;
  }

  get(type, callback) {
    switch (type) {
      case 'power':
        this.platform.getDimmer(this.deviceId, (level) => {
          callback(null, level ? 1 : 0);
        });
        break;
      case 'brightness':
        this.platform.getDimmer(this.deviceId, (level) => {
          callback(null, level);
        });
        break;
      default:
        throw new Error('Invalid Characteristic requested');
    }
  }

  setPower(state, callback) {
    this.platform.setDimmer(this.deviceId, state ? 100 : 0, () => {
      callback();
    });
  }

  setBrightness(value, callback) {
    this.platform.setDimmer(this.deviceId, value, () => {
      callback();
    });
  }

  getServices() {
    const services = [];
    this.service = new Service.Lightbulb(this.name);

    // gets and sets over the remote api
    this.service.getCharacteristic(Characteristic.On)
      .on('get', (callback) => { this.get('power', callback); })
      .on('set', (value, callback) => { this.setPower(value, callback); });

    this.service.addCharacteristic(Characteristic.Brightness)
      .on('get', (callback) => { this.get('brightness', callback); })
      .on('set', (value, callback) => { this.setBrightness(value, callback); });

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
    };
    this.connect();
  }

  connect() {
    const p = this[priv];
    p.state = sendUsername;

    p.socket = net.connect(23, this[priv].config.host);
    p.socket.on('data', (data) => {
      p.log(`RECEIVED>>${String(data)}<<`);
      p.state(p, data);
    }).on('connect', () => {
      p.log('Connected to RadioRA controller');
    }).on('end', () => { });
  }

  disconnect() {
    this[priv].socket.end();
  }

  sendCommand(command) {
    const p = this[priv];
    let toSend = command;
    if (!/\r\n$/.test(toSend)) {
      toSend += '\r\n';
    }
    if (p.ready) {
      p.log(`Sending ${toSend}`);
      p.socket.write(toSend);
    } else {
      p.log('Adding command to queue');
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
    let cmd = `#OUTPUT,${id},1,${level}`;
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
    const result = (msg) => {
      if (msg.type === 'status' && numId === msg.id) {
        this.removeListener(MESSAGE_RECEIVED, result);
        callback(msg.level);
      }
    };
    const cmd = `?OUTPUT,${numId}`;
    this.on(MESSAGE_RECEIVED, result);
    this.sendCommand(cmd);
  }

  accessories(callback) {
    this[priv].log('Fetching RadioRA devices.');
    const items = [];
    for (let i = 0; i < this[priv].config.lights.length; i++) {
      items.push(new RadioRAItem(this.log, this[priv].config.lights[i], this));
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

module.exports = Homebridge;

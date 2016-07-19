'use strict';

var events = require('events');
var util = require('util');
var net = require('net');

// RadioRA2 Platform Shim for HomeBridge
//
// Remember to add platform to config.json. Example:
// "platforms": [
//     {
//         "platform": "RadioRA",             // required
//         "name": "RadioRA",                 // required
//     }
// ],
//
// When you attempt to add a device, it will ask for a "PIN code".
// The default code for all HomeBridge accessories is 031-45-154.
//

function RadioRA(log, config) {
    events.EventEmitter.call(this);
    this.config = config;
    this.log = log;
    this.log('RadioRA Platform Created');

    var me = this;

    var readyForCommand = false;
    var loggedIn = false;
    var socket = null;
    var state = null;
    var commandQueue = [];
    var responderQueue = [];

    function sendUsername(prompt) {
        if (prompt != "login: ") {
            log("Bad initial response /" + prompt + "/");
            return;
        }
        socket.write(config.username + "\r\n");
        state = sendPassword;
    }

    function sendPassword(prompt) {
        if (prompt != "password: ") {
            log("Bad login response /" + prompt + "/");
            return;
        }
        state = incomingData;
        socket.write(config.password + "\r\n");
    }

    function incomingData(data) {
        var str = String(data), m;
        if (/GNET>\s/.test(str)) {
            if (!loggedIn) {
                log('Logged into RadioRA controller');
            }
            readyForCommand = true;
            if (commandQueue.length) {
                var msg = commandQueue.shift();
                socket.write(msg);
            }
            return;
        } else if ((m = /^~OUTPUT,(\d+),1,([\d\.]+)/.exec(str))) {
            me.emit("messageReceived", { type: 'status', id: m[1], level: m[2] });
        }
    }

    this.connect = function () {
        state = sendUsername;

        socket = net.connect(23, config.host);
        socket.on('data', function (data) {
            log("RECEIVED>>" + String(data) + "<<");
            state(data);
        }).on('connect', function () {
            log('Connected to RadioRA controller');
        }).on('end', function () {
        });
    };
    this.sendCommand = function (command) {
        if (!/\r\n$/.test(command)) {
            command += "\r\n";
        }
        if (readyForCommand) {
            readyForCommand = false;
            this.log('Sending ' + command);
            socket.write(command);
        } else {
            commandQueue.push(command);
        }
    };
    this.setDimmer = function (id, level, fade, delay, cb) {
        if (!cb) { cb = delay; delay = null; }
        if (!cb) { cb = fade; fade = null; }
        var result;
        result = function (msg) {
            if (msg.type == "status" && id == msg.id) {
                if (cb) {
                    cb(msg);
                }
                me.removeListener('messageReceived', result);
            }
        }
        me.on('messageReceived', result)
        var cmd = "#OUTPUT," + id + ",1," + level;
        if (fade) {
            cmd += "," + fade;
            if (delay) {
                cmd += "," + delay;
            }
        }
        me.sendCommand(cmd);
    };
    this.connect();
}

util.inherits(RadioRA, events.EventEmitter);

RadioRA.prototype.accessories = function (callback) {
    this.log("Fetching RadioRA devices.");
    var items = []
    for (var i = 0; i < this.config.lights.length; i++) {
        items.push(new RadioRAItem(this.log, this.config.lights[i], this));
    }
    callback(items);
};

function RadioRAItem(log, item, platform) {
    // device info
    this.name = item.name;
    this.model = 'RadioRA';
    this.deviceId = item.id;
    this.serial = item.serial;
    this.log = log;
    this.platform = platform;

    /*
        if (use_lan != false && lifx_lan.bulbs[this.deviceId]) {
            var that = this;
            this.bulb = lifx_lan.bulbs[this.deviceId];
    
            lifx_lan.on('bulbstate', function(bulb) {
                if (bulb.addr.toString('hex') == that.deviceId) {
                    that.bulb = bulb;
    
                    if (that.service) {
                        that.service.getCharacteristic(Characteristic.On).setValue(that.bulb.state.power > 0);
                        that.service.getCharacteristic(Characteristic.Brightness).setValue(Math.round(that.bulb.state.brightness * 100 / 65535));
    
                        if (that.capabilities.has_color == true) {
                            that.service.getCharacteristic(Characteristic.Hue).setValue(Math.round(that.bulb.state.hue * 360 / 65535));
                            that.service.getCharacteristic(Characteristic.Saturation).setValue(Math.round(that.bulb.state.saturation * 100 / 65535));
                        }
                    }
                }
            });
        }
        */
}

RadioRAItem.prototype = {
    get: function (type, callback) {
        var that = this;

        callback(new Error("Device not found"), false);
        /*
        lifx_remote.listLights("id:" + that.deviceId, function (body) {
            var bulb = JSON.parse(body);

            if (bulb.connected != true) {
                callback(new Error("Device not found"), false);
                return;
            }

            switch (type) {
                case "power":
                    callback(null, bulb.power == "on" ? 1 : 0);
                    break;
                case "brightness":
                    callback(null, Math.round(bulb.brightness * 100));
                    break;
            }
        });*/
    },
    identify: function (callback) {
        lifx_remote.breatheEffect("id:" + this.deviceId, 'green', null, 1, 3, false, true, 0.5, function (body) {
            callback();
        });
    },
    setPower: function (state, callback) {
        var log = this.log;
        this.platform.setDimmer(this.deviceId, state ? 100 : 0, function (msg) {
            callback();
        });
    },
    setBrightness: function (value, callback) {
        var log = this.log;
        this.platform.setDimmer(this.deviceId, value, function (msg) {
            callback();
        });
    },
    getServices: function () {
        var that = this;
        var services = []
        this.service = new Service.Lightbulb(this.name);

        // gets and sets over the remote api
        this.service.getCharacteristic(Characteristic.On)
            .on('get', function (callback) { that.get("power", callback); })
            .on('set', function (value, callback) { that.setPower(value, callback); });

        this.service.addCharacteristic(Characteristic.Brightness)
            .on('get', function (callback) { that.get("brightness", callback); })
            .on('set', function (value, callback) { that.setBrightness(value, callback); });

        services.push(this.service);

        var service = new Service.AccessoryInformation();

        service.setCharacteristic(Characteristic.Manufacturer, "LUTRON")
            .setCharacteristic(Characteristic.Model, this.model)
            .setCharacteristic(Characteristic.SerialNumber, this.serial);

        services.push(service);

        return services;
    }
}

module.exports.accessory = RadioRAItem;
module.exports.platform = RadioRA;

var Service, Characteristic;

module.exports = function (homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;

    homebridge.registerAccessory("homebridge-radiora-item", "RadioRAItem", RadioRAItem);
    homebridge.registerPlatform("homebridge-radiora", "RadioRA", RadioRA);
};
//HIFI2 PLATFORM

var net = require("net");
var Service, Characteristic, Accessory, uuid;
var inherits = require('util').inherits;
var extend = require('util')._extend;

var clients = [];
var powerIOs = [];
var volumeIOs = [];
var sourceIOs = [];


/* Register the plugin with homebridge */
module.exports = function (homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    Accessory = homebridge.hap.Accessory;
    uuid = homebridge.hap.uuid;

    homebridge.registerPlatform("homebridge-HIFI2", "HIFI2", HIFIPlatform);
}

function HIFIPlatform(log, config) {
    this.log = log;
    this.devices = config.devices;
}

HIFIPlatform.prototype.accessories = function (callback) {
    if (Array.isArray(this.devices)) {
        var devicesProcessed = 0;
        for (var deviceIndex = 0; deviceIndex < this.devices.length; deviceIndex++) {
            var results = [];
            var currentDeviceConfig = this.devices[deviceIndex];

            //clientsCurrentIO.push(firstcurrentIO);
            clients.push(new net.Socket());
            var client = clients[deviceIndex];
            client.log = this.log;

            powerIOs.push([]);
            var powerIO = powerIOs[deviceIndex];
            volumeIOs.push([]);
            var volumeIO = volumeIOs[deviceIndex];
            sourceIOs.push([]);
            var sourceIO = sourceIOs[deviceIndex];

            var port = currentDeviceConfig.port;
            var host = currentDeviceConfig.host;

            client.connect(port, host, function () {
                this.log("Connected to " + host + ":" + port);
                client.write('*Z0POWER?\r\n');
            });

            client.on('close', function () {
                client.connect(port, host, function () {
                    //this.log("Connected to " + host + ":" + port);
                });
            });

            // client.setTimeout(10000, function (err) {
            //     this.log("Timed out connecting to " + host + ":" + port);
            //     callback([]);
            //     client.destroy();
            // });

            var responseCount = 0;
            var finishedLoadingDevices = false;


            client.on('data', function (data) {
                if(!finishedLoadingDevices) {
                    var response = data.toString('utf-8').trim();

                    var responseItems = response.split("\n")
                    responseItems.forEach(function(item) {
                        if(item.includes("POWER")){
                            var zone = item.split("Z")[1].split("P")[0];
                            var power = item.split("POWER")[1].split("\r")[0];
                            powerIO.push(parseInt(power))
                        } else if(item.includes("SRC")){
                            var zone = item.split("Z")[1].split("S")[0];
                            var source = item.split("SRC")[1].split("\r")[0];
                            sourceIO.push(parseInt(source))
                        } else if(item.includes("VOLUME")){
                            var zone = item.split("Z")[1].split("V")[0];
                            var volume = item.split("VOLUME")[1].split("\r")[0];
                            volumeIO.push(parseInt(volume));
                        }
                    })
                    if(response.includes("POWER")) {
                        client.write('*Z0SRC?\r\n')
                    } else if(response.includes("SRC")) {
                        client.write('*Z0VOLUME?\r\n')
                    }
                    responseCount++
                    if(responseCount == 3) {
                        console.log(powerIO);
                        console.log(sourceIO);
                        console.log(volumeIO);
                        finishedLoadingDevices = true;

                        if (powerIO.length == currentDeviceConfig.outputs.length) {
                            this.log("Found " + powerIO.length + " ouputs");
                            for (var i = 0; i < currentDeviceConfig.outputs.length; i++) {
                                if (currentDeviceConfig.outputs[i] !== "") {
                                    results.push(new HIFIOutput(this.log, i, currentDeviceConfig, powerIO[i], sourceIO[i], volumeIO[i], client));
                                    devicesProcessed++;
                                }
                            }
                            if (results.length === 0)
                            {
                                  this.log("WARNING: No Accessories were loaded.");
                            }
                            callback(results)
                        } else {
                            this.log(new Error("Unexpected response in fetching devices from matrix: " + results));
                            callback(results);
                        }
                    }
                }
            });
        }
    } else {
        this.log("Error parsing config file");
    }
}

function HIFIOutput(log, output, config, power, source, volume, client) {
    this.log = log;
    this.name = config.outputs[output];
    this.inputs = []
    this.services = []
    this.output = output;
    this.client = client
    this.power = power
    this.volume = volume
    this.source = source

    this.log("Configuring HIFI output: " + config.outputs[output]);

    for(var i = 0; i < config.inputs.length; i++){
        if (config.inputs[i] !== "") {
            this.addInput(new HIFIInput(this.log, config.inputs[i] + " " + config.outputs[this.output], this.output, i, this.source, this.client))
        }
    }

    this.powerService = new HIFIPower(this.log, this.name, this.output, this.power, this.client)
    this.addPower(this.powerService)

    this.volumeService = new HIFIVolume(this.log, this.name, this.output, this.volume, this.client)
    this.addVolume(this.volumeService)

    var informationService = new Service.AccessoryInformation();
    informationService
        .setCharacteristic(Characteristic.Manufacturer, 'HIFI2')
        .setCharacteristic(Characteristic.Model, config.outputs[this.output])
        .setCharacteristic(Characteristic.SerialNumber, config.outputs[this.output]);

    this.services.push(informationService);

    this.client.on('data', function (data) {
        var response = data.toString('utf-8').trim();
        var checkready = response.split("\n");
        var responseItems = response.split("\n")
        responseItems.forEach(function(item) {
            if(item.includes("POWER")){
                var zone = parseInt(item.split("Z")[1].split("P")[0]);
                if(zone == (this.output + 1)){
                    var power = item.split("POWER")[1].split("\r")[0];
                    console.log("zone " + zone + ", power: " + power);
                    this.power = parseInt(power)
                    this.powerService.setSelfState(parseInt(power));
                }
            } else if(item.includes("SRC")){
                var zone = parseInt(item.split("Z")[1].split("S")[0]);
                if(zone == (this.output + 1)){
                    var source = item.split("SRC")[1].split("\r")[0];
                    console.log("zone " + zone + ", source: " + source);
                    this.source = parseInt(source)
                    this.inputs.forEach(function(input) {
                        input.setSelfState(parseInt(source))
                    });
                }
            } else if(item.includes("VOLUME")){
                var zone = parseInt(item.split("Z")[1].split("V")[0]);
                if(zone == (this.output + 1)){
                    var volume = item.split("VOLUME")[1].split("\r")[0];
                    console.log("zone " + zone + ", volume: " + volume);
                    this.volume = parseInt(volume)
                    this.volumeService.setSelfState(parseInt(volume));
                }
            }
        }.bind(this))
    }.bind(this));

    this.client.on('close', function () {
        //this.log("Connection lost to " + this.name);
    }.bind(this));
}

HIFIOutput.prototype.addInput = function (newInput) {
    this.inputs.push(newInput);
    this.services.push(newInput.getService());
}

HIFIOutput.prototype.addVolume = function (newVolume) {
    this.services.push(newVolume.getService());
}

HIFIOutput.prototype.addPower = function (newPower) {
    this.services.push(newPower.getService());
}

HIFIOutput.prototype.getServices = function () {
    return this.services
}

/////////////////////INPUT
function HIFIInput(log, name, output, input, currentInput, client) {
    this.name = name + " Sound";
    this.input = input;
    this.output = output;
    this.log = log;
    this.client = client;

    this.service = new Service.Switch(this.name);
    this.service.subtype = "output" + (output + 1) + "input"+(input+1);
    this.service
        .getCharacteristic(Characteristic.On)
        .on('set', this.setState.bind(this))
        .on('get', this.getState.bind(this));

    this.currentInput = currentInput
    this.state = true;
    this.setSelfState(currentInput)

    this.log(this.name);
}

HIFIInput.prototype.getService = function() {
    this.log(this.name + " getService");
    return this.service;
}

HIFIInput.prototype.getState = function (callback) {
    callback(null, this.state);
}


HIFIInput.prototype.setState = function (state, callback) {
    this.state = state;
    this.currentInput = this.input + 1
    if (this.selfSet) {
      this.selfSet = false;
      callback(null);
      return;
    }

    if(state){
        var command = "*Z" + (this.output + 1) + "SRC" + (this.input + 1) ;
        this.client.write(command + "\r\n");
        this.log(command)
        var date = new Date()
        do { curDate = new Date(); }
        while(curDate-date < 50);
    }

    callback(null);
}

HIFIInput.prototype.setSelfState = function (currentInput) {
    var state = false;
    if (currentInput == (this.input+1)) {
      state = true
    }
    if(this.state !== state) {
        this.state = state;
        this.selfSet = true;
        this.service
          .getCharacteristic(Characteristic.On)
          .setValue(state);
    }
}


/////////////////////POWER
function HIFIPower(log, name, output, state, client) {
    this.name = name + " Sound";
    this.output = output;
    this.log = log;
    this.client = client;
    this.state = state

    this.service = new Service.Switch(this.name);
    this.service.subtype = "output" + (output + 1) + "power";
    this.service
        .getCharacteristic(Characteristic.On)
        .on('set', this.setState.bind(this))
        .on('get', this.getState.bind(this));


    this.setSelfState(state);
    this.log(this.name);
}

HIFIPower.prototype.getService = function() {
    this.log(this.name + " getService");
    return this.service;
}

HIFIPower.prototype.getState = function (callback) {
    callback(null, this.state);
}


HIFIPower.prototype.setState = function (state, callback) {
    var changedState = '0'
    if(state){
        changedState = '1'
    }
    var command = "*Z" + (this.output + 1) + "POWER" + changedState ;
    this.state = state;

    if (this.selfSet) {
      this.selfSet = false;
      callback(null);
      return;
    }

    this.client.write(command + "\r\n");
    this.log(command)
    var date = new Date()
    do { curDate = new Date(); }
    while(curDate-date < 50);
    callback(null);
}

HIFIPower.prototype.setSelfState = function (state) {
    this.selfSet = true;
    this.service
      .getCharacteristic(Characteristic.On)
      .setValue(state);
}

/////////////////////VOLUME
function HIFIVolume(log, name, output, volume, client) {
    this.name = name + " Volume";
    this.output = output;
    this.log = log;
    this.client = client;
    this.state = true;
    this.volume = volume;

    this.service = new Service.Lightbulb(this.name);
    this.service.subtype = "output" + (output + 1) + "volume";
    this.service
        .getCharacteristic(Characteristic.On)
        .on('set', this.setState.bind(this))
        .on('get', this.getState.bind(this));

    this.service
        .getCharacteristic(Characteristic.Brightness)
        .on('set', this.setBrightness.bind(this))
        .on('get', this.getBrightness.bind(this));


    this.setSelfState(volume);
    this.log(this.name);
}

HIFIVolume.prototype.getService = function() {
    this.log(this.name + " getService");
    return this.service;
}

HIFIVolume.prototype.getState = function (callback) {
    callback(null, this.state);
}


HIFIVolume.prototype.setState = function (state, callback) {
    callback(null);
}

HIFIVolume.prototype.getBrightness = function (callback) {
    callback(null, this.volume);
}

HIFIVolume.prototype.setBrightness = function (state, callback) {
    if (state == 100) {
        state = 20;
    }

    var command = "*Z" + (this.output + 1) + "VOLUME" + state ;
    this.volume = state;

    if (this.selfSet) {
      this.selfSet = false;
      callback(null);
      return;
    }

    this.client.write(command + "\r\n");
    this.log(command)
    var date = new Date()
    do { curDate = new Date(); }
    while(curDate-date < 50);
    callback(null);
}

HIFIVolume.prototype.setSelfState = function (state) {
    this.selfSet = true;
    this.service
      .getCharacteristic(Characteristic.Brightness)
      .setValue(state);
}

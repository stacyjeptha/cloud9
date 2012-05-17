"use strict";

/**
 * Run shell commands
 */

var exports = module.exports = function setup(options, imports, register) {
    var pm = imports["process-manager"];

    pm.addRunner("shell", exports.factory(imports.vfs));

    register(null, {
        "run-shell": {}
    });
};

exports.factory = function(vfs) {
    return function(args, eventEmitter, eventName) {
        return new Runner(vfs, {
            command: args.command, args: args.args, cwd: args.cwd,
            env: args.env, encoding: args.encoding, extra: args.extra,
            eventEmitter: eventEmitter, eventName: eventName
        });
    };
};

var Runner = exports.Runner = function(vfs, options) {
    this.vfs = vfs;
    this.uid = options.uid;
    this.command = options.command;
    this.args = options.args || [];
    this.encoding = options.encoding || "utf8";

    if (this.encoding === "binary") {
        this.encoding = null;
    }
    this.extra = options.extra;

    this.runOptions = {};
    if (options.cwd)
        this.runOptions.cwd = options.cwd;

    var env = options.env || {};

    for (var key in process.env)
        if (!env.hasOwnProperty(key))
            env[key] = process.env[key];

    this.runOptions.env = env;

    this.eventEmitter = options.eventEmitter;
    this.eventName = options.eventName;

    this.child = {
        pid: null
    };

    var self = this;
    this.__defineGetter__("pid", function(){
        return (self.child.exitCode === null && self.child.signalCode === null)  ? self.child.pid : 0;
    });
};

(function() {

    this.name = "shell";

    this.exec = function(onStart, onExit) {
        var self = this;
        this.createChild(function(err, child) {
            if (err)
                return onStart(err);

            self.child = child;
            onStart(null, child.pid);

            var out = "";
            var err = "";

            child.on("exit", function(code) {
                onExit(code, out, err);
            });

            child.stdout.on("data", function (data) {
                out += data.toString("utf8");
            });

            child.stderr.on("data", function (data) {
                err += data.toString("utf8");
            });
        });
    };

    this.spawn = function(callback) {
        var self = this;
        this.createChild(function(err, child) {
            if (err)
                return callback(err);

            self.child = child;
            self.attachEvents(child);

            callback(null, child.pid);
        });
    };

    this.createChild = function(callback) {
        this.runOptions.args = this.args;
        this.vfs.spawn(this.command, this.runOptions, function(err, meta) {
            callback(err, meta && meta.process);
        });
    };

    this.attachEvents = function(child) {
        var self = this;
        var pid = child.pid;

        child.stdout.on("data", sender("stdout"));
        child.stderr.on("data", sender("stderr"));

        if (this.encoding) {
            child.stdout.setEncoding(this.encoding);
            child.stderr.setEncoding(this.encoding);
        }

        function emit(msg) {
            // console.log(self.eventName, msg);
            self.eventEmitter.emit(self.eventName, msg);
        }

        function sender(stream) {
            return function(data) {
                emit({
                    "type": self.name + "-data",
                    "pid": pid,
                    "stream": stream,
                    "data": data,
                    "extra": self.extra
                });
            };
        }

        child.on("exit", function(code) {
            emit({
                "type": self.name + "-exit",
                "pid": pid,
                "code": code,
                "extra": self.extra
            });
        });

        process.nextTick(function() {
            emit({
                "type": self.name + "-start",
                "pid": pid,
                "extra": self.extra
            });
        });
    };

    this.kill = function() {
        this.child && this.child.kill();
    };

    this.describe = function() {
        return {
            command: [this.command].concat(this.args).join(" "),
            type: this.name
        };
    };

}).call(Runner.prototype);
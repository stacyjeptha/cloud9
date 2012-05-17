"use strict";

var util = require("util");
var ShellRunner = require("../cloud9.run.shell/shell").Runner;

var exports = module.exports = function setup(options, imports, register) {
   var pm = imports["process-manager"];

    imports.sandbox.getProjectDir(function(err, projectDir) {
        if (err)
            return register(err);

       pm.addRunner("run-npm", exports.factory(imports.vfs, projectDir));

       register(null, {
           "run-run-npm": {}
       });
   });
};

exports.factory = function(vfs, projectDir) {
    return function(args, eventEmitter, eventName) {
        var cwd = args.cwd || projectDir;
        return new Runner(vfs, args.file, args.args, cwd, args.env, args.extra, eventEmitter, eventName);
    };
};

var Runner = exports.Runner = function(vfs, file, args, cwd, env, extra, eventEmitter, eventName) {
    this.file = file;
    this.extra = extra;

    this.scriptArgs = args || [];
    this.nodeArgs = [];

    env = env || {};
    ShellRunner.call(this, vfs, {
        command: process.execPath,
        args: [],
        cwd: cwd,
        env: env,
        extra: extra,
        eventEmitter: eventEmitter,
        eventName: eventName
    });
};

util.inherits(Runner, ShellRunner);

(function() {

    this.name = "run-npm";

    this.createChild = function(callback) {
        this.args = this.nodeArgs.concat(this.file, this.scriptArgs);
        ShellRunner.prototype.createChild.call(this, callback);
    };

}).call(Runner.prototype);
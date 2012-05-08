/**
 * Java Runtime Module for the Cloud9 IDE
 *
 * @copyright 2010, Ajax.org B.V.
 * @license GPLv3 <http://www.gnu.org/licenses/gpl.txt>
 */
var Path              = require("path"),
    Plugin            = require("cloud9/plugin"),
    sys               = require("sys"),
    netutil           = require("cloud9/netutil"),
    JavaDebugProxy    = require("./javadebugproxy"),
    jvm               = require("jvm-run/lib/jvm_instance"),
    JVMInstance       = jvm.JVMInstance,
    ScriptJVMInstance = jvm.ScriptJVMInstance,
    WebJVMInstance    = jvm.WebJVMInstance,
    build             = jvm.build;

var JVMRuntimePlugin = module.exports = function(ide, workspace) {
    this.ide = ide;
    this.workspace = workspace;
    this.hooks = ["command"];
    this.name = "jvm-runtime";
};

sys.inherits(JVMRuntimePlugin, Plugin);

(function() {
    this.init = function() {
        var _self = this;
        this.workspace.getExt("state").on("statechange", function(state) {
            state.processRunning = !!_self.instance;
            state.debugClient = !! _self.debugClient;
        });
    };

    this.JAVA_DEBUG_PORT = 6000;
    this.WEBAPP_START_PORT = 10000;

    this.command = function(user, message, client) {
        var cmd = (message.command || "").toLowerCase();
        if (!(/java|jpy|jrb|groovy|js-rhino/.test(message.runner))
            && (cmd.indexOf("debug") != -1 && !this.javaDebugProxy))
          return false;

        var _self = this;

        var res = true;

        switch (cmd) {
            case "run":
                this.$run(message, client);
                break;
            case "rundebug":
            case "rundebugbrk":
                netutil.findFreePort(this.JAVA_DEBUG_PORT, this.JAVA_DEBUG_PORT + 1000, "localhost",
                    function(err, port) {
                    if (err) return _self.$error("Could not find a free port", 9, message);

                    message.debugPort = port;
                    message.debug = true;
                    _self.$run(message, client);
                });
                break;
            case "debugnode":
                this.javaDebugProxy.send(message.body);
                break;
            case "debugattachnode":
                if (this.javaDebugProxy)
                    this.ide.broadcast('{"type": "node-debug-ready"}', _self.name);
                break;
            case "kill":
                this.$procExit();
                break;
            default:
                res = false;
                break;
        }
        return res;
    };

    this.$error = function(message, code, data) {
        this.ide.broadcast(JSON.stringify({
            "type": "error",
            "message": message,
            "code": code || 0,
            "data": data || ""
        }), this.name);
    };

    function srcToJavaClass(file) {
        return file.substring("src/".length)
            .replace(new RegExp("/", "g"), ".")
            .replace(/\.java$/, "");
    }

    // Refactored to run the debug process from javascript code
    this.$debug = function (message, file, cwd) {
        var _self = this;

        var appPath = cwd;
        var debugOptions = {
            port: message.debugPort,
            sourcepath: appPath + 'src'
        };

        if (this.javaDebugProxy)
            return this.$error("Debug session already running", 4, message);

        this.javaDebugProxy = new JavaDebugProxy(this.JAVA_DEBUG_PORT, debugOptions);
        this.javaDebugProxy.on("message", function(body) {
            var msg = {
                "type": "node-debug",
                "body": body
            };
            _self.ide.broadcast(JSON.stringify(msg), _self.name);
        });

        this.javaDebugProxy.on("connection", function() {
            _self.debugClient = true;
            _self.workspace.getExt("state").publishState();
            _self.ide.broadcast('{"type": "node-start"}', _self.name);
            _self.ide.broadcast('{"type": "node-debug-ready"}', _self.name);
        });

        this.javaDebugProxy.on("end", function(err) {
            console.log('javaDebugProxy terminated');
            // in case an error occured, send a message back to the client
            if (err) {
                // TODO: err should be an exception instance with more fields
                // TODO: in theory a "node-start" event might be sent after this event (though
                //       extremely unlikely). Deal with all this event mess
                _self.send({"type": "node-exit-with-error", errorMessage: err}, null, _self.name);
                // the idea is that if the "node-exit-with-error" event is dispatched,
                // then the "node-exit" event is not.
                if (_self.child)
                    _self.child.removeAllListeners("exit");
                // in this case the debugger process is still running. We need to
                // kill that process, while not interfering with other parts of the source.
                _self.$procExit(true);
            }
            if (_self.javaDebugProxy === this)
                delete _self.javaDebugProxy;
        });

        this.javaDebugProxy.connect();
    };

    this.$run = function(message, client) {
        console.log('$run called');
        var _self = this;

        if (this.instance)
            return _self.$error("Child process already running!", 1, message);

        var file = _self.workspace.workspaceDir + "/" + message.file;

        Path.exists(file, function(exists) {
           if (!exists)
               return _self.$error("File does not exist: " + message.file, 2, message);

           var cwd = _self.ide.workspaceDir + "/" + (message.cwd || "");
           Path.exists(cwd, function(exists) {
               if (!exists)
                   return _self.$error("cwd does not exist: " + message.cwd, 3, message);
                // lets check what we need to run
                var args = [].concat(file).concat(message.args || []);
                // message.runner = "java", "jy", "jrb", "groovy", "js-rhino"
                // Only java debug is now supported
                _self.$runJVM(message, file.substring(cwd.length), args, cwd, message.debug);
           });
        });
    };

    this.$runJVM = function(message, file, args, cwd, isDebug) {
        var _self = this;

        var jvmInstance;
        var runner = message.runner;

        switch (runner) {
            case "java":
                var javaClass = srcToJavaClass(file);
                jvmInstance = new JVMInstance(cwd, javaClass);
                break;

            case "java-web":
                netutil.findFreePort(this.WEBAPP_START_PORT, this.WEBAPP_START_PORT + 1000, "localhost",
                    function(err, port) {

                    if (err) return _self.$error("Could not find a free port", 1, err);

                    jvmInstance = new WebJVMInstance(cwd, 'j2ee', port);
                    jvmInstance.on('lifecycle:started', function() {
                        // TODO, notify the client that the server is now started
                        // _self.ide.broadcast(JSON.stringify({}), _self.name);
                    });
                });
                break;

            case "jpy":
                jvmInstance = new ScriptJVMInstance(cwd, "jython", file);
                break;

            case "jrb":
                jvmInstance = new ScriptJVMInstance(cwd, "jruby1.8.7", file);
                break;

            case "groovy":
                jvmInstance = new ScriptJVMInstance(cwd, "groovy", file);
                break;

            case "js-rhino":
                console.error("JS-Rhino not tested yet");
                break;

            default:
                console.error("unsupported runtime environment")
        }

        switch (runner) {
            case "java":
            case "java-web":
                build(cwd, function(err, compilationProblems) {
                    if (err)  return console.error(err);

                    // If no errors found, we can start
                    if (compilationProblems.filter(function (problem) {
                        return problem.type == "error"; }).length == 0) {
                        start();
                    }
                    else {
                        console.log("Found " + compilationProblems.length + " compilation errors");
                        // send compilation errors to the user
                        _self.sendResult(0, "jvmfeatures:build", {
                            success: true,
                            body: compilationProblems
                        });
                    }
                }, "build");
                break;
            case "jpy":
            case "jrb":
            case "groovy":
            case "js-rhino":
                start();
                break;
        }

        function start() {
            var debugPort = null;
            if (isDebug && (runner == 'java' || runner == 'java-web'))
                debugPort = message.debugPort;

            console.log("JVM started");
            jvmInstance.on("output", sender("stdout"));
            jvmInstance.on("err", sender("stderr"));

            _self.instance = jvmInstance;
            _self.workspace.getExt("state").publishState();
            _self.ide.broadcast(JSON.stringify({"type": "node-start"}), _self.name);
            jvmInstance.start(debugPort);

            jvmInstance.on("exit", function(code) {
                _self.$procExit();
            });

            if (debugPort) {
                // TODO fix the deterministic time or change the launch strategy
                setTimeout(function function_name (argument) {
                    _self.$debug(message, file, cwd);
                }, 1000);
            }
        }

        function sender(stream) {
            return function(data) {
                var message = {
                    "type": "node-data",
                    "stream": stream,
                    "data": data.toString("utf8")
                };
                _self.ide.broadcast(JSON.stringify(message), _self.name);
            };
        }

        return jvmInstance;
    };

    this.$procExit = function(noBroadcast) {
        if (!noBroadcast)
            this.ide.broadcast(JSON.stringify({"type": "node-exit"}), this.name);

        if (this.instance) {
            this.instance.kill();
        }

        this.workspace.getExt("state").publishState();

        delete this.instance;
        delete this.debugClient;
        delete this.javaDebugProxy;
    };

    this.dispose = function(callback) {
        this.$procExit();
        callback();
    };

}).call(JVMRuntimePlugin.prototype);

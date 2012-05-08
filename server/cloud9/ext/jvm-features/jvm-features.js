/**
 * Python Runtime Module for the Cloud9 IDE
 *
 * @copyright 2010, Ajax.org B.V.
 * @license GPLv3 <http://www.gnu.org/licenses/gpl.txt>
 */
var Path             = require("path"),
    Plugin           = require("cloud9/plugin"),
    sys              = require("sys"),
    util             = require("util"),
    netutil          = require("cloud9/netutil"),
    EclipseClient    = require("eclipse/eclipse_client");

var JVMFeatures = module.exports = function(ide, workspace) {
    Plugin.call(this, ide, workspace);
    this.hooks = ["connect", "disconnect", "command"];
    this.name = "jvm-features";
    this.basePath  = ide.workspaceDir + "/";
};

sys.inherits(JVMFeatures, Plugin);

(function() {

    this.ECLIPSE_START_PORT = 10000;

    this.command = function(user, message, client) {
        var cmd = message.command;
        if (cmd != "jvmfeatures")
            return false;

        var _self = this;
        var subCmd = (message.subcommand || "").toLowerCase();

        if (! this.eclipseClient)
          return this.$error("No eclipse session running! " + cmd+":"+subCmd+":"+message.file, 2);

        function resultSender(data) {
            if (! data.success)
                console.error("Could not execute " + subCmd + " request");
            _self.sendResult(0, cmd + ":" + subCmd, {
                success: data.success,
                body: data.body || null
            });
        }

        var res = true;
        switch (subCmd) {
            case "complete":
                this.eclipseClient.codeComplete(message.project, message.file, message.offset,
                  function(data) {
                    // var absFilePath = Path.join(_self.basePath, message.file);
                    // console.log("file: " + absFilePath + ":" + message.offset + " & matches: " + matches);
                    resultSender(data);
                    /* var matches = data.body || [];
                    for (var i = 0; i < matches.length; i++) {
                        console.log(util.inspect(matches[i], true, null));
                    }*/
                });
              break;

            // get locations of a variable or funcion call in the same file
            case "get_locations":
                this.eclipseClient.getLocations(message.project, message.file, message.offset, message.length,
                  function(data) {
                    var matches = data.body || [];
                    data.body = {
                        uses: matches.filter(function(match) {
                            return match.type == "reference";
                        }),
                        declarations: matches.filter(function(match) {
                            return match.type == "declaration";
                        })
                    };
                    resultSender(data);
                });
              break;

            // Do refactoring
            case "refactor":
                this.eclipseClient.refactor(message.project, message.file,
                    message.newname, message.offset, message.length, resultSender);
              break;

            case "outline":
                this.eclipseClient.outline(message.project, message.file, resultSender);
                break;

            case "code_format":
                this.eclipseClient.codeFormat(message.project, message.file, resultSender);
                break;

            case "analyze_file":
              this.eclipseClient.analyzeFile(message.project, message.file, resultSender);
                break;

            case "hierarchy":
              this.eclipseClient.hierarchy(message.project, message.file, message.offset,
                  message.type, resultSender);
                break;

            case "build":
              this.eclipseClient.buildProject(message.project, resultSender);
                break;

            case "navigate":
              this.eclipseClient.navigate(message.project, message.file, message.navType,
                  message.offset, message.length, resultSender);
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

    this.connect = function(user, client) {
        var _self = this;

        //  init the eclipse instance for that user
        netutil.findFreePort(this.ECLIPSE_START_PORT, this.ECLIPSE_START_PORT + 1000, "localhost",
          function(err, port) {
            if (err)
              return _self.$error("Could not find a free port", 1, err);
            var eclipseClient = new EclipseClient("localhost", port,
                "/home/ubuntu/runtime-CodeCompletePlugin.Cloud9Eclipse");
            eclipseClient.on("lifecycle:connected", function() {
              console.log("Eclipse session initalied");
              _self.eclipseClient = eclipseClient;
            });
            eclipseClient.on("output", console.log);
            eclipseClient.on("err", console.error);
            eclipseClient.initEclipseSession();
        });
        return true;
    };

    this.disconnect = function(user, client) {
        if (this.eclipseClient) {
          this.eclipseClient.disconnect();
          this.eclipseClient = null;
          console.log("Eclipse session disposed");
        }
        return true;
    };

    this.dispose = function(callback) {
        callback();
    };

}).call(JVMFeatures.prototype);

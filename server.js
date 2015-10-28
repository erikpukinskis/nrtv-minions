var library = require("nrtv-library")(require)

module.exports = library.export(
  "minion-server",
  ["nrtv-single-use-socket", "nrtv-server", "./dispatcher", "./api"],
  function(SingleUseSocket, server, Dispatcher, api) {

    var startedServer

    function start(port, queue) {

      if (!queue) {
        queue = new Dispatcher()
      }

      SingleUseSocket.getReady()

      server.get(
        "/minions",
        function(request, response) {

          library.using(["./frame", library.reset("nrtv-browser-bridge")], 
            function(buildFrame, bridge) {

              var iframe = buildFrame(bridge, queue)

              bridge.sendPage(iframe)(request, response)
            }
          )

        }
      )

      api.installHandlers(server, queue)

      server.start(port || 9777)

      startedServer = server
    }

    function stop() {
      startedServer.stop()
    }

    return {
      start: start,
      stop: stop,
      getPort: function() {
        return startedServer.port
      }
    }
  }
)
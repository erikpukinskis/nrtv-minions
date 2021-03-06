var library = require("module-library")(require)

module.exports = library.export(
  "minion-api-client",
  ["make-request", "job-pool", "http", "guarantor"],
  function(makeRequest, JobPool, http, guarantor) {


    // SERVER

    function installHandlers(server, jobPool) {

      // Called when we just do a simple addTask without retaining a worker. Adds the task to the global pool
      server.addRoute(
        "post",
        "/tasks",
        function(request, response) {
          var task = request.body
          task.callback = function(message) {
            response.send(message)
          }
          jobPool.addTask(task)
        }
      )

      var retainedMinions = {}

      server.addRoute(
        "post",
        "/retainers",
        function(request, response) {

          var retainer = jobPool.retainWorker()

          do {
            var id = Math.random().toString(36).split(".")[1].substr(0,5)
          } while(retainedMinions[id])

          console.log("RETAINED minion", id)

          retainedMinions[id] = retainer

          response.send({
            id: id
          })
        }
      )

      server.addRoute(
        "delete",
        "/retainers/:id",
        function(request, response) {
          var id = request.params.id
          var minion = retainedMinions[id]
          if (!minion) {
            console.log("Tried to resign minion", id, "but it is long gone.")
            return
          }
          console.log("RESIGNED minion", id)
          minion.resign()
          delete retainedMinions[id]
          response.send({ok: true})
        }
      )

      // Looks up a specific retained worker, which is a job-pool Retainer.
      server.addRoute(
        "post",
        "/retainers/:id/tasks",
        function(request, response) {
          var id = request.params.id
          var minion = retainedMinions[id]

          if (!minion) {
            var message = "Tried to give a task to minion on retainer "+id+" but there is no such retained minion."
            response.status(410).send(message)
            console.log(message)
            return
          }

          try {
            retainedMinions[id].addTask(
              request.body,
              function(message) {
                response.send(message)
              }
            )
          } catch(e) {
            console.log(e.stack)
            response.status(500).send(e.message)
          }
        }
      )

    }


    // CLIENT

    function addTask() {
      var task = JobPool.buildTask(arguments)
      _addTask(task)
    }

    // Send a JobPool "task" via HTTP to an API server. This either will just be a plain task for any old worker to take, or it will have a prefix if this task is for a specific worker.
    // We call this _addTask function from both the exported addTask function and the addTask method on the ApiRetainer class.
    function _addTask(task, prefix) {
      var source = task.func.toString()

      // This is a bad smell, trying to match the format of dispatcher. I think all of this API is actually just dispatcher api, and can go there? Minions is really about the frame and the server.... although even some of that seems more suited to nrtv-browse.

      var data = {
        isNrtvDispatcherTask: true,
        funcSource: source,
        options: task.options,
        args: task.args
      }

      var path = (prefix||"")+"/tasks"

      post({
        path: path,
        data: data
      }, function(body) {
        task.callback(body)
      })
    }

    function buildUrl(path) {
      return (api.host || "http://localhost:9777") + path
    }

    function post(options, callback) {

      var url = buildUrl(options.prefix||"")+options.path

      var params = {
        method: "POST",
        url: url,
        data: options.data
      }

      try {
        throw new Error("Minions API request failed")
      } catch(e) {
        var apiError = e
      }

      makeRequest(
        params,
        function(content, response, error) {

          if (error) {
            console.log(" ⚡⚡⚡ ERROR ⚡⚡⚡ ", content||"")
            console.log("There was an error trying to connect to the server for your request:", JSON.stringify(params, null, 2))
            throw(apiError)
          } else if (response.statusCode >= 400) {
            console.log(" ⚡⚡⚡ ERROR ⚡⚡⚡ ", content||"")
            console.log("The server returned status code", response.statusCode, "which suggests there was something wrong with your request:", JSON.stringify(params, null, 2))
            if (response.statusCode >= 500) {
              console.log("Check the server logs for details.")
            }
            throw(apiError)
          } else {
            callback(content)
          }
        }
      )

    }

    function retainMinion(callback) {
      post({
        path: "/retainers",
      },
      function(response) {
        console.log("RETAINED", response.id)
        callback(
          new ApiRetainer(response.id)
        )
      })
    }


    var unresignedMinions = {}
    guarantor(resignMinions)

    function resignMinions(callback) {
      var ids = Object.keys(unresignedMinions)

      if (ids.length) {
        console.log("\nWe have", ids.length, "minion(s) still to clean up. Working on it... hit ctrl+c to give up\n")
      }

      function resignMore() {
        var id = ids.pop()

        if (!id) {
          return callback()
        }
        var minion = unresignedMinions[id]
        minion.resign(resignMore)
      }

      resignMore()
    }

    function ApiRetainer(id) {
      this.id = id
      unresignedMinions[id] = this
    }

    ApiRetainer.prototype.addTask =
      function() {
        var task = JobPool.buildTask(arguments)
        var prefix = "/retainers/"+this.id
        _addTask(task, prefix)
      }

    ApiRetainer.prototype.resign =
      function(callback) {
        var id = this.id
        var url = buildUrl("/retainers/"+id)
        makeRequest({
          method: "DELETE",
          url: url
        }, function(x, response, error) {
          if (error) { throw error }
          if (response.statusCode != 200) {
            throw new Error(response.body)
          }
          delete unresignedMinions[id]
          callback && callback()
        })
      }

    var api = {
      addTask: addTask,
      retainMinion: retainMinion,
      installOnWebSite: installHandlers,
      at: function(url) {
        if (this.host) {
          throw new Error("Already set api host to "+this.host)
        }
        this.host = url
        return this
      },
    }

    return api
  }
)
var should      = require("should")
var sdkConfPath = process.env.sdkconf || "./config/sdk.json"
var sdkConf     = require(sdkConfPath)
var stamp       = "t" + new Date().toJSON().split("-").join("").split(":").join("").split(".").join("")
var creds       = { user: stamp + "@chloi.io", pass: "secret" }

// config.defaults lets the caller register a handler per http status. the cli
// registers 403 and 404 and both call process.exit(1), so the handler firing
// BEFORE the callback is load-bearing — the callback is not supposed to run.
// nothing else in the suite exercises this.

var withDefaults = function(defaults){
  return require("../sdk")({
    endpoint: sdkConf.endpoint,
    version: sdkConf.version,
    defaults: defaults
  })
}

describe("defaults", function(){

  it("should fire the status handler before the callback", function(done){
    var order = []
    var handed = null

    var sdk = withDefaults({
      404: function(e, r, b){
        order.push("handler")
        handed = r
      }
    })

    sdk.status(stamp + "-unpublished.surge.sh", creds, function(error){
      order.push("callback")
      order.should.eql(["handler", "callback"])

      // the handler is handed the response, and reads .status off it
      should.exist(handed)
      handed.should.have.property("status", 404)

      error.should.have.property("status", 404)
      return done()
    })
  })

  it("should fire the handler on a successful response too", function(done){
    var fired = 0

    var sdk = withDefaults({
      200: function(e, r, b){
        fired++
        r.should.have.property("status", 200)
        should.exist(b)
      }
    })

    sdk.stats(function(error, stats){
      should.not.exist(error)
      fired.should.equal(1)
      stats.should.have.property("projects")
      return done()
    })
  })

  it("should leave unregistered statuses alone", function(done){
    var fired = 0

    var sdk = withDefaults({
      402: function(){ fired++ }
    })

    sdk.status(stamp + "-unpublished.surge.sh", creds, function(error){
      fired.should.equal(0)
      error.should.have.property("status", 404)
      return done()
    })
  })

  it("should clean up", function(done){
    var sdk = withDefaults({})
    sdk.nuke(creds, function(){ return done() })
  })

})

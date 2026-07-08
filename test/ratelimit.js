
var should      = require("should")
var sdkConfPath = process.env.sdkconf || "./config/sdk.json"
var sdkConf     = require(sdkConfPath)

var stream      = require("../stream")
var sdk         = require("../sdk")(sdkConf, stream)
var stamp       = "t" + new Date().toJSON().split("-").join("").split(":").join("").split(".").join("").toLowerCase()
var creds       = { user: stamp + "-rl@chloi.io", pass: "secret" }
var domain      = "rl-" + stamp + ".lvh.me"


describe("rate limit", function(){
  this.timeout(30000)
  var project = __dirname + "/mocks/hello-world"
  var auth;

  it("should create account", function(done){
    sdk.token(creds, function(errors, token){
      token.should.have.property("user", "token")
      token.should.have.property("pass")
      auth = token
      return done()
    })
  })

  it("should emit ratelimited once the domain publish limit is exceeded", function(done){
    // unverified accounts get half the 30/15min domain limit, so attempt 16
    // must come back 429. Rejected attempts also count against the window
    // (hard limit) so the loop converges no matter the configured max
    var attempts = 0
    var finished = false

    var attempt = function(){
      attempts++
      if (attempts > 20){
        finished = true
        return done(new Error("not rate limited after " + (attempts - 1) + " publishes"))
      }
      sdk.publish(project, domain, auth, {
        "file-count": "99",
        "cmd": "test",
        "project-size": "9999",
        "timestamp": new Date().toJSON()
      }).on("info", function(){
        if (!finished) attempt()
      }).on("ratelimited", function(msg){
        if (finished) return
        finished = true
        msg.should.match(/Rate limited/)
        return done()
      }).on("fail", function(){
        // fail always follows ratelimited; only a bare fail is an error
        if (finished) return
        finished = true
        return done(new Error("publish failed without a ratelimited event (attempt " + attempts + ")"))
      })
    }
    attempt()
  })

  it("should remove project", function(done){
    sdk.teardown(domain, auth, function(error, info){
      should.not.exist(error)
      return done()
    })
  })

  it("should nuke account", function(done){
    sdk.nuke(auth, function(error, info){
      should.not.exist(error)
      return done()
    })
  })

})

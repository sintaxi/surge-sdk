var should      = require("should")
var sdkConfPath = process.env.sdkconf || "./config/sdk.json"
var sdkConf     = require(sdkConfPath)
var stream      = require("../stream")
var sdk         = require("../sdk")(sdkConf, stream)
var stamp       = "t" + new Date().toJSON().split("-").join("").split(":").join("").split(".").join("")
var creds       = { user: stamp + "@chloi.io", pass: "secret" }

describe("status", function(){

  var domainName = `st${ Math.floor(Math.random() * 1000) }.lvh.me`

  it("should report a platform subdomain as trivially live", function(done){
    sdk.status(stamp + "-status.surge.sh", creds, function(error, reply){
      should.not.exist(error)
      reply.status.should.equal("live")
      reply.action.should.equal("visit")
      reply.https.should.equal(true)
      return done()
    })
  })

  it("should claim a custom domain by publishing", function(done){
    sdk.publish(__dirname + "/mocks/hello-world", domainName, creds, {
      "file-count": "99",
      "cmd": "test",
      "project-size": "9999",
      "timestamp": new Date().toJSON()
    }).on("info", function(obj){
      return done()
    })
  })

  it("should report the one user action when dns points elsewhere", function(done){
    // *.lvh.me resolves to 127.0.0.1 — real records, none of them ours
    sdk.status(domainName, creds, function(error, reply){
      should.not.exist(error)
      reply.status.should.equal("waiting on dns")
      reply.action.should.equal("dns")
      reply.https.should.equal(false)
      reply.reason.should.equal("elsewhere")
      should.exist(reply.records.cname)
      reply.records.a.should.be.instanceof(Array)
      return done()
    })
  })

  it("should let a domain-scoped token read status", function(done){
    sdk.tokenAdd({ scope: [domainName] }, creds, function(error, record){
      should.not.exist(error)
      sdk.status(domainName, { user: "token", pass: record.token }, function(error, reply){
        should.not.exist(error)
        reply.status.should.equal("waiting on dns")
        return done()
      })
    })
  })

  it("should clean up", function(done){
    sdk.teardown(domainName, creds, function(error){
      sdk.nuke(creds, function(error){
        should.not.exist(error)
        return done()
      })
    })
  })

})

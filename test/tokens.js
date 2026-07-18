var should      = require("should")
var sdkConfPath = process.env.sdkconf || "./config/sdk.json"
var sdkConf     = require(sdkConfPath)
var stream      = require("../stream")
var sdk         = require("../sdk")(sdkConf, stream)
var stamp       = "t" + new Date().toJSON().split("-").join("").split(":").join("").split(".").join("")
var creds       = { user: stamp + "@chloi.io", pass: "secret" }

describe("tokens", function(){

  var domainName = `tk${ Math.floor(Math.random() * 1000) }.lvh.me`
  var accountToken, scopedToken, scopedId;

  it("should create account and mint a token with a msg", function(done){
    sdk.tokenAdd({ msg: "ci deploys" }, creds, function(error, record){
      should.not.exist(error)
      record.should.have.property("token")
      record.should.have.property("id", "tok-" + record.token.slice(0, 8))
      record.should.have.property("msg", "ci deploys")
      record.should.have.property("created_at")
      record.scope.should.be.instanceof(Array).and.have.length(0)
      accountToken = record.token
      return done()
    })
  })

  it("should keep the login shape on token()", function(done){
    sdk.token(creds, { msg: "login test" }, function(error, auth){
      should.not.exist(error)
      auth.should.have.property("user", "token")
      auth.should.have.property("pass")
      return done()
    })
  })

  it("should mint a domain-scoped token", function(done){
    sdk.tokenAdd({ msg: "scoped ci", scope: [domainName] }, creds, function(error, record){
      should.not.exist(error)
      record.scope.should.eql([domainName])
      scopedToken  = record.token
      scopedId     = record.id
      return done()
    })
  })

  it("should list tokens with usage and without values", function(done){
    sdk.tokens({ user: "token", pass: accountToken }, function(error, records){
      should.not.exist(error)
      records.length.should.be.above(2)
      records.forEach(function(record){
        record.should.not.have.property("token")
        record.id.should.startWith("tok-")
        record.should.have.property("uses")
        record.should.have.property("created_at")
      })
      var self = records.filter(function(r){ return r.msg === "ci deploys" })[0]
      self.uses.should.be.above(0)
      should.exist(self.last_used_at)
      return done()
    })
  })

  it("should deny a scoped token the account routes", function(done){
    sdk.tokens({ user: "token", pass: scopedToken }, function(error, records){
      should.exist(error)
      error.should.have.property("status", 403)
      return done()
    })
  })

  it("should let a scoped token read its own identity", function(done){
    sdk.account({ user: "token", pass: scopedToken }, function(error, account){
      should.not.exist(error)
      account.should.have.property("email", creds.user)
      return done()
    })
  })

  it("should claim the domain by publishing with account creds", function(done){
    sdk.publish(__dirname + "/mocks/hello-world", domainName, creds, {
      "file-count": "99",
      "cmd": "test",
      "project-size": "9999",
      "timestamp": new Date().toJSON()
    }).on("info", function(obj){
      return done()
    })
  })

  it("should deny minting a scoped token for another account's domain", function(done){
    var strangerCreds = { user: "x" + stamp + "@chloi.io", pass: "secret" }
    sdk.tokenAdd({ scope: [domainName] }, strangerCreds, function(error, record){
      should.exist(error)
      error.should.have.property("status", 403)
      return done()
    })
  })

  it("should publish within scope using a scoped token", function(done){
    sdk.publish(__dirname + "/mocks/hello-world", domainName, { user: "token", pass: scopedToken }, {
      "file-count": "99",
      "cmd": "test",
      "project-size": "9999",
      "timestamp": new Date().toJSON()
    }).on("info", function(obj){
      return done()
    })
  })

  it("should not publish out of scope using a scoped token", function(done){
    sdk.publish(__dirname + "/mocks/hello-world", "other-" + domainName, { user: "token", pass: scopedToken }, {
      "file-count": "99",
      "cmd": "test",
      "project-size": "9999",
      "timestamp": new Date().toJSON()
    }).on("forbidden", function(msg){
      return done()
    })
  })

  it("should remove a token by id", function(done){
    sdk.tokenRem(scopedId, { user: "token", pass: accountToken }, function(error, rsp){
      should.not.exist(error)
      sdk.list({ user: "token", pass: scopedToken }, function(error, projects){
        should.exist(error)
        error.should.have.property("status", 401)
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

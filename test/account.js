
var should      = require("should")
var sdkConfPath = process.env.sdkconf || "./config/sdk.json"
var sdkConf     = require(sdkConfPath)
var stream      = require("../stream")
var sdk         = require("../sdk")(sdkConf, stream)
var stamp       = "t" + new Date().toJSON().split("-").join("").split(":").join("").split(".").join("")
var creds       = { user: stamp + "@chloi.io", pass: "secret" }

describe("account", function(){
  var projectPath = __dirname + "/mocks/hello-world"
  var auth, accountObject;
  var domainName = `abc${ Math.floor(Math.random() * 1000) }.lvh.me`
  
  
  it("should return site stats", function(done){
    sdk.stats(function(error, stats){
      should.not.exist(error)
      stats.should.have.property("projects")
      stats.should.have.property("deployemnts")
      stats.should.have.property("bytes")
      stats.should.have.property("files")
      return done()
    })
  })

  it("should not create account with invalid email /account", function(done){
    sdk.account({ user: "notanemail", pass: "secret" }, function(error, account){
      error.should.have.property("details")
      error.should.have.property("messages")
      error.should.have.property("status", 401)
      done()
    })
  })

  it("should fetch or create /account", function(done){
    sdk.account(creds, function(error, account){
      should.not.exist(error)
      account.should.have.property("id")
      account.should.have.property("uuid")
      account.should.have.property("payment_id")
      account.should.have.property("updated_at")
      account.should.have.property("created_at")
      account.should.have.property("email_verified_at")
      account.should.have.property("email")
      account.should.have.property("role")
      account.should.have.property("plan")
      account.should.have.property("card")
      accountObject = account
      return done()
    })
  })

  it("should return error when attempting to create account already created", function(done){
    var c = {
      user: creds.user,
      pass: "invalid"
    }
    sdk.account(c, function(error, account){
      error.should.have.property("details")
      error.should.have.property("messages")
      error.should.have.property("status")
      return done()
    })
  })

  it("should create token using valid creds", function(done){
    sdk.token(creds, function(error, token){
      should.not.exist(error)
      token.should.have.property("user")
      token.should.have.property("pass")
      auth = token
      return done()
    })
  })

  it("should fetch /account using valid token", function(done){
    sdk.account(auth, function(error, account){
      should.not.exist(error)
      account.should.have.property("id")
      account.should.have.property("uuid")
      account.should.have.property("payment_id")
      account.should.have.property("updated_at")
      account.should.have.property("created_at")
      account.should.have.property("email_verified_at")
      account.should.have.property("email")
      account.should.have.property("role")
      account.should.have.property("plan")
      account.should.have.property("card")
      account.should.eql(accountObject)
      return done()
    })
  })

  it("should get error if invalid token", function(done){
    sdk.account({ user: "token", pass: "123" }, function(error, account){
      error.should.have.property("details")
      error.should.have.property("messages")
      error.should.have.property("status", 401)
      return done()      
    })
  })

  it("should fail to remove account with invalid token", function(done){
    sdk.nuke({ user: "token", pass: "123" }, function(error, account){
      should.exist(error)
      error.should.have.property("details")
      error.should.have.property("messages")
      error.should.have.property("status", 401)
      return done()      
    })
  })

  it("should fail to nuke with projects", function(done){
    sdk.publish(projectPath, domainName, auth, {
      "file-count": "99",
      "cmd": "test",
      "project-size": "9999",
      "timestamp": new Date().toJSON()
    }).on("info", function(msg){
      sdk.nuke(auth, function(error){
        error.should.have.property("details")
        error.should.have.property("messages")
        error.should.have.property("status", 409)
        return done()      
      })
    })
  })

  it("should be able to nuke account once project is removed", function(done){
    sdk.teardown(domainName, auth, function(error, info){
      should.not.exist(error)
      sdk.nuke(auth, function(error, info){
        should.not.exist(error)
        info.should.have.property("msg")
        return done()
      })
    })
  })

})

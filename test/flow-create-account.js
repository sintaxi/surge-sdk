
var should      = require("should")
var sdkConfPath = process.env.sdkconf || "./config/sdk.json"
var sdkConf     = require(sdkConfPath)
var stream      = require("../stream")
var sdk         = require("../sdk")(sdkConf, stream)

var stamp       = "t" + new Date().toJSON().split("-").join("").split(":").join("").split(".").join("")



describe("flow create account " + stamp, function(){
  var projectOne  = "one-" + stamp + ".lvh.me"
  var projectTwo  = "two-" + stamp + ".lvh.me"
  var creds       = { user: stamp + "@chloi.io", pass: "secret" }

  var projectPath = __dirname + "/mocks/hello-world"
  var auth, accountObject;

  it("should create account", function(done){
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

  it("should create token using valid creds", function(done){
    sdk.token(creds, function(error, token){
      should.not.exist(error)
      token.should.have.property("user")
      token.should.have.property("pass")
      auth = token
      return done()
    })
  })

  it("should fetch account using valid token", function(done){
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

  it("should publish first project", function(done){
    sdk.publish(projectPath, projectOne, auth, {
      "file-count": "99",
      "cmd": "test",
      "project-size": "9999",
      "timestamp": new Date().toJSON()
    }).on("info", function(msg){
      return done()
    })
  })

  it("should publish second project", function(done){
    sdk.publish(projectPath, projectTwo, auth, {
      "file-count": "99",
      "cmd": "test",
      "project-size": "9999",
      "timestamp": new Date().toJSON()
    }).on("info", function(msg){
      return done()
    })
  })

  it("should publish first project a second time", function(done){
    sdk.publish(projectPath, projectOne, auth, {
      "file-count": "99",
      "cmd": "test",
      "project-size": "9999",
      "timestamp": new Date().toJSON()
    }).on("info", function(msg){
      return done()
    })
  })

  it("should publish first project a second time", function(done){
    sdk.publish(projectPath, projectTwo, auth, {
      "file-count": "99",
      "cmd": "test",
      "project-size": "9999",
      "timestamp": new Date().toJSON()
    }).on("info", function(msg){
      return done()
    })
  })

  it("should list projects", function(done){
    sdk.list(auth, function(error, projects){
      should.not.exist(error)
      projects.should.be.instanceof(Array).and.have.lengthOf(2)
      return done()
    })
  })

  it("should teardown first project", function(done){
    sdk.teardown(projectOne, auth, function(error, info){
      should.not.exist(error)
      return done()
    })
  })

  it("should teardown second project", function(done){
    sdk.teardown(projectTwo, auth, function(error, info){
      should.not.exist(error)
      return done()
    })
  })

  it("should nuke account", function(done){
    sdk.nuke(auth, function(error, info){
      should.not.exist(error)
      info.should.have.property("msg")
      return done()
    })
  })

})

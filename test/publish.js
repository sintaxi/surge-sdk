
var should      = require("should")
var sdkConfPath = process.env.sdkconf || "./config/sdk.json"
var sdkConf     = require(sdkConfPath)
var sdk         = require("../")(sdkConf)


describe("publish", function(){
  var project     = __dirname + "/mocks/hello-world"
  var creds       = { user: "brock@chloi.io", pass: "secret" }
  var domain = "hello-world.lvh.me"
  var auth, accountObject;
  

  it("should create account", function(done){
    sdk.token(creds, function(errors, token){
      token.should.have.property("user", "token")
      token.should.have.property("pass")
      auth = token
      return done()
    })
  })

  it("should reject invalid pojectname", function(done){
    sdk.publish(project, "invalid domain", auth, {
      "file-count": "99",
      "cmd": "test",
      "project-size": "9999",
      "timestamp": new Date().toJSON()
    }).on("invalid", function(error){
      //should.exist(error)
      //error.should.eql("Invalid")
      return done()
    })
  })

  it("should publish hello-world", function(done){
    sdk.publish(project, domain, auth, {
      "file-count": "99",
      "cmd": "test",
      "project-size": "9999",
      "timestamp": new Date().toJSON()
    }).on("invalid", function(error){
      console.log("what!!")
      return done()
    }).on("regionInfo", function(obj){
      obj.should.have.property("nsDomain")
      obj.should.have.property("regions")
      return done()
    })
  })

  it("should include project in list", function(done){
    sdk.list(auth, function(error, projects){
      projects.should.be.instanceof(Array).and.have.lengthOf(1)
      done()
    })
  })

  it("should be unauthorized if publishing with invalid token", function(done){
    sdk.publish(project, domain, { user: "token", pass: "1234" }, {
      "file-count": "99",
      "cmd": "test",
      "project-size": "9999",
      "timestamp": new Date().toJSON()
    }).on("unauthorized", function(msg){
      msg.should.equal("Unauthorized")
      return done()
    })
  })

  it("should be unauthorized if publishing without correct password", function(done){
    sdk.publish(project, domain, { user: creds.user, pass: "1234" }, {
      "file-count": "99",
      "cmd": "test",
      "project-size": "9999",
      "timestamp": new Date().toJSON()
    }).on("unauthorized", function(msg){
      msg.should.equal("Unauthorized")
      return done()
    })
  })

  it("should be Forbidden if publishing without permission", function(done){
    sdk.publish(project, domain, { user: "test@chloi.io", pass: "1234" }, {
      "file-count": "99",
      "cmd": "test",
      "project-size": "9999",
      "timestamp": new Date().toJSON()
    }).on("forbidden", function(msg){
      msg.should.equal("Forbidden")
      return done()
    })
  })

  it("should fetch hello-world metadata", function(done){
    sdk.metadata(domain, auth, function(errrors, metadata){
      metadata.should.have.property("rev")
      metadata.should.have.property("cmd", "test")
      metadata.should.have.property("email", creds.user)
      metadata.should.have.property("platform")
      metadata.should.have.property("cliVersion", "999")
      metadata.should.have.property("publicFileCount", 1)
      metadata.should.have.property("publicTotalSize", 21)
      metadata.should.have.property("privateFileCount", 1)
      metadata.should.have.property("privateTotalSize", 21)
      metadata.should.have.property("uploadStartTime")
      metadata.should.have.property("uploadEndTime")
      metadata.should.have.property("uploadDuration")
      return done()
    })
  })

  it("should fetch hello-world manifest", function(done){
    sdk.manifest(domain, auth, function(errrors, manifest){
      manifest.should.have.property("/index.html")
      return done()
    })
  })

  it("should fetch list which includes hello-world project", function(done){
    sdk.list(auth, function(errrors, projects){
      projects.should.be.instanceof(Array).and.have.lengthOf(1)
      projects[0].should.have.property("domain", "hello-world.lvh.me")
      projects[0].should.have.property("rev")
      projects[0].should.have.property("cmd", "test")
      projects[0].should.have.property("email", creds.user)
      projects[0].should.have.property("platform")
      projects[0].should.have.property("cliVersion")
      projects[0].should.have.property("output")
      projects[0].should.have.property("config")
      projects[0].should.have.property("message")
      projects[0].should.have.property("buildTime")
      projects[0].should.have.property("privateFileList")
      projects[0].should.have.property("publicFileCount", 1)
      projects[0].should.have.property("publicTotalSize")
      projects[0].should.have.property("privateFileCount", 1)
      projects[0].should.have.property("privateTotalSize")
      projects[0].should.have.property("uploadStartTime")
      projects[0].should.have.property("uploadEndTime")
      projects[0].should.have.property("uploadDuration")
      projects[0].should.have.property("timeAgoInWords")
      return done()
    })
  })

  it("should remove hello-world project", function(done){
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


var should      = require("should")
var sdkConfPath = process.env.sdkconf || "./config/sdk.json"
var sdkConf     = require(sdkConfPath)
var sdk         = require("../")(sdkConf)
var stamp       = "t" + new Date().toJSON().split("-").join("").split(":").join("").split(".").join("").toLowerCase()
var creds       = { user: stamp + "@chloi.io", pass: "secret" }
var projectOne  = "one-" + stamp + ".lvh.me"
var projectTwo  = "two-" + stamp + ".lvh.me"


describe("revisions", function(){
  var project   = __dirname + "/mocks/hello-world"
  var domain    = projectOne
  var auth, accountObject, revisionToSet, revisionToDel;
  

  it("should create account", function(done){
    sdk.token(creds, function(errors, token){
      token.should.have.property("user", "token")
      token.should.have.property("pass")
      auth = token
      return done()
    })
  })

  it("should publish hello-world", function(done){
    sdk.publish(project, domain, auth, {
      "file-count": "99",
      "cmd": "test",
      "project-size": "9999",
      "timestamp": new Date().toJSON()
    }).on("info", function(obj){
      obj.should.have.property("instances")
      return done()
    })
  })

  it("should publish hello-world a second time", function(done){
    sdk.publish(project, domain, auth, {
      "file-count": "99",
      "cmd": "test",
      "project-size": "9999",
      "timestamp": new Date().toJSON()
    }).on("info", function(obj){
      obj.should.have.property("instances")
      return done()
    })
  })

  it("should publish hello-world a third time", function(done){
    sdk.publish(project, domain, auth, {
      "file-count": "99",
      "cmd": "test",
      "project-size": "9999",
      "timestamp": new Date().toJSON()
    }).on("info", function(obj){
      obj.should.have.property("instances")
      return done()
    })
  })

  it("should return list of revisions", function(done){
    sdk.list(domain, auth, function(error, revisions){
      should.not.exist(error)
      revisions.should.be.instanceof(Array).and.have.lengthOf(3)
      revisions[0].should.have.property("timeAgoInWords")
      revisions[0].should.have.property("current", true)
      revisions[1].should.have.property("current", false)
      revisions[2].should.have.property("current", false)
      return done()
    })
  })

  it("should rollback to second revision", function(done){
    sdk.rollback(domain, auth, function(error, cloudInfo){
      should.not.exist(error)
      should.exist(cloudInfo)
      cloudInfo.should.have.property("revision")
      sdk.list(domain, auth, function(error, revisions){
        should.not.exist(error)
        revisions.should.be.instanceof(Array).and.have.lengthOf(3)
        revisions[0].should.have.property("current", false)
        revisions[1].should.have.property("current", true)
        revisions[2].should.have.property("current", false)
        return done()
      })
    })
  })

  it("should rollback to first revision", function(done){
    sdk.rollback(domain, auth, function(error, cloudInfo){
      should.not.exist(error)
      cloudInfo.should.have.property("revision")
      cloudInfo.should.have.property("instances")
      sdk.list(domain, auth, function(error, revisions){
        should.not.exist(error)
        revisions.should.be.instanceof(Array).and.have.lengthOf(3)
        revisions[0].should.have.property("current", false)
        revisions[1].should.have.property("current", false)
        revisions[2].should.have.property("current", true)
        return done()
      })
    })
  })

  it("should remain on first when attempting another rollback", function(done){
    sdk.rollback(domain, auth, function(error, cloudInfo){
      should.not.exist(error)
      cloudInfo.should.have.property("revision")
      cloudInfo.should.have.property("instances")
      sdk.list(domain, auth, function(error, revisions){
        should.not.exist(error)
        revisions.should.be.instanceof(Array).and.have.lengthOf(3)
        revisions[0].should.have.property("current", false)
        revisions[1].should.have.property("current", false)
        revisions[2].should.have.property("current", true)
        sdk.metadata(domain, auth, function(error, metadata){
          metadata.rev.should.equal(revisions[2].rev)
          return done()
        })
      })
    })
  })

  it("should switch to second build when rolling forward", function(done){
    sdk.rollfore(domain, auth, function(error, cloudInfo){
      should.not.exist(error)
      cloudInfo.should.have.property("revision")
      cloudInfo.should.have.property("instances")
      sdk.list(domain, auth, function(error, revisions){
        should.not.exist(error)
        revisions.should.be.instanceof(Array).and.have.lengthOf(3)
        revisions[0].should.have.property("current", false)
        revisions[1].should.have.property("current", true)
        revisions[2].should.have.property("current", false)
        sdk.metadata(domain, auth, function(error, metadata){
          metadata.rev.should.equal(revisions[1].rev)
          return done()
        })
      })
    })
  })

  it("should switch to third build when rolling forward", function(done){
    sdk.rollfore(domain, auth, function(error, cloudInfo){
      should.not.exist(error)
      cloudInfo.should.have.property("revision")
      cloudInfo.should.have.property("instances")
      sdk.list(domain, auth, function(error, revisions){
        should.not.exist(error)
        revisions.should.be.instanceof(Array).and.have.lengthOf(3)
        revisions[0].should.have.property("current", true)
        revisions[1].should.have.property("current", false)
        revisions[2].should.have.property("current", false)
        return done()
      })
    })
  })

  it("should switch remain on third build when attempting another forward", function(done){
    sdk.rollfore(domain, auth, function(error, cloudInfo){
      should.not.exist(error)
      cloudInfo.should.have.property("revision")
      cloudInfo.should.have.property("instances")
      sdk.list(domain, auth, function(error, revisions){
        should.not.exist(error)
        revisions.should.be.instanceof(Array).and.have.lengthOf(3)
        revisions[0].should.have.property("current", true)
        revisions[1].should.have.property("current", false)
        revisions[2].should.have.property("current", false)
        revisionToSet = revisions[2].rev
        return done()
      })
    })
  })

  it("should get error when attempting to cutover to nonexisting project", function(done){
    sdk.cutover("non-existing-project.lvh.me", 9999, auth, function(error, cloudInfo){
      should.exist(error)
      error.should.have.property("details")
      error.should.have.property("messages")
      error.should.have.property("status", 404)
      return done()
    })
  })

  it("should get error when attempting to cutover to nonexisting rev", function(done){
    sdk.cutover(domain, 9999, auth, function(error, cloudInfo){
      should.exist(error)
      error.should.have.property("details")
      error.should.have.property("messages")
      error.should.have.property("status", 404)
      return done()
    })
  })

  it("should cut back to original revision using domain", function(done){
    var rev = [revisionToSet, domain].join("-")
    sdk.cutover(domain, rev, auth, function(error, cloudInfo){
      should.not.exist(error)
      cloudInfo.should.have.property("revision")
      cloudInfo.should.have.property("instances")
      sdk.list(domain, auth, function(error, revisions){
        should.not.exist(error)
        revisions.should.be.instanceof(Array).and.have.lengthOf(3)
        revisions[0].should.have.property("current", false)
        revisions[1].should.have.property("current", false)
        revisions[2].should.have.property("current", true)
        sdk.metadata(domain, auth, function(error, metadata){
          metadata.rev.should.equal(revisions[2].rev)
          return done()
        })
      })
    })
  })

  it("should publish hello-world to a staging url", function(done){
    sdk.publish(project, domain, auth, {
      "file-count": "99",
      "cmd": "test",
      "project-size": "9999",
      "timestamp": new Date().toJSON(),
      "stage": true
    }).on("info", function(obj){
      obj.should.have.property("instances")
      sdk.list(domain, auth, function(error, revisions){
        should.not.exist(error)
        revisions.should.be.instanceof(Array).and.have.lengthOf(4)
        revisions[0].should.have.property("current", false)
        revisions[1].should.have.property("current", false)
        revisions[2].should.have.property("current", false)
        revisions[3].should.have.property("current", true)
        sdk.metadata(domain, auth, function(error, metadata){
          metadata.rev.should.equal(revisions[3].rev)
          return done()
        })
      })
    })
  })

  it("should publish hello-world to a new staging url", function(done){
    sdk.publish(project, domain, auth, {
      "file-count": "99",
      "cmd": "test",
      "project-size": "9999",
      "timestamp": new Date().toJSON(),
      "stage": true
    }).on("info", function(obj){
      obj.should.have.property("instances")
      sdk.list(domain, auth, function(error, revisions){
        should.not.exist(error)
        revisions.should.be.instanceof(Array).and.have.lengthOf(5)
        revisions[0].should.have.property("current", false)
        revisions[1].should.have.property("current", false)
        revisions[2].should.have.property("current", false)
        revisions[3].should.have.property("current", false)
        revisions[4].should.have.property("current", true)
        sdk.metadata(domain, auth, function(error, metadata){
          metadata.rev.should.equal(revisions[4].rev)
          return done()
        })
      })
    })
  })

  it("should cut back to original revision", function(done){
    sdk.cutover(domain, auth, function(error, cloudInfo){
      should.not.exist(error)
      cloudInfo.should.have.property("revision")
      cloudInfo.should.have.property("instances")
      sdk.list(domain, auth, function(error, revisions){
        should.not.exist(error)
        revisions.should.be.instanceof(Array).and.have.lengthOf(5)
        revisions[0].should.have.property("current", true)
        revisions[1].should.have.property("current", false)
        revisions[2].should.have.property("current", false)
        revisions[3].should.have.property("current", false)
        revisions[4].should.have.property("current", false)
        sdk.metadata(domain, auth, function(error, metadata){
          metadata.rev.should.equal(revisions[0].rev)
          return done()
        })
      })
    })
  })

  it("should publish hello-world to a staging url", function(done){
    sdk.publish(project, domain, auth, {
      "file-count": "99",
      "cmd": "test",
      "project-size": "9999",
      "timestamp": new Date().toJSON(),
      "stage": true
    }).on("info", function(obj){
      obj.should.have.property("instances")
      sdk.list(domain, auth, function(error, revisions){
        should.not.exist(error)
        revisions.should.be.instanceof(Array).and.have.lengthOf(6)
        revisions[0].should.have.property("current", false)
        revisions[1].should.have.property("current", true)
        revisions[2].should.have.property("current", false)
        revisions[3].should.have.property("current", false)
        revisions[4].should.have.property("current", false)
        revisions[5].should.have.property("current", false)
        sdk.metadata(domain, auth, function(error, metadata){
          metadata.rev.should.equal(revisions[1].rev)
          return done()
        })
      })
    })
  })

  it("should publish hello-world to production url", function(done){
    sdk.publish(project, domain, auth, {
      "file-count": "99",
      "cmd": "test",
      "project-size": "9999",
      "timestamp": new Date().toJSON()
    }).on("info", function(obj){
      obj.should.have.property("instances")
      sdk.list(domain, auth, function(error, revisions){
        should.not.exist(error)
        revisions.should.be.instanceof(Array).and.have.lengthOf(7)
        revisions[0].should.have.property("current", true)
        revisions[1].should.have.property("current", false)
        revisions[2].should.have.property("current", false)
        revisions[3].should.have.property("current", false)
        revisions[4].should.have.property("current", false)
        revisions[5].should.have.property("current", false)
        revisions[6].should.have.property("current", false)
        revisionToDel = revisions[0].rev
        sdk.metadata(domain, auth, function(error, metadata){
          metadata.rev.should.equal(revisions[0].rev)
          return done()
        })
      })
    })
  })

  it("should remove build", function(done){
    sdk.discard(domain, revisionToDel, auth, function(error, cloudInfo){
      should.not.exist(error)
      cloudInfo.should.have.property("revision")
      cloudInfo.should.have.property("instances")
      sdk.list(domain, auth, function(error, revisions){
        should.not.exist(error)
        revisions.should.be.instanceof(Array).and.have.lengthOf(6)
        return done()
      })
    })
  })

  it("should remove project", function(done){
    sdk.teardown(domain, auth, function(error, cloudInfo){
      should.not.exist(error)
      cloudInfo.should.have.property("msg")
      cloudInfo.should.have.property("instances")
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

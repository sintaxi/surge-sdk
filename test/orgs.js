var should      = require("should")
var sdkConfPath = process.env.sdkconf || "./config/sdk.json"
var sdkConf     = require(sdkConfPath)
var stream      = require("../stream")
var sdk         = require("../sdk")(sdkConf, stream)
var stamp       = "t" + new Date().toJSON().split("-").join("").split(":").join("").split(".").join("")
var creds       = { user: "orgs-" + stamp + "@chloi.io", pass: "secret" }

// the wire shape of the org calls. Creating and renaming need a verified
// email, which a test account doesn't have: the api's own suite covers
// those (slushi test/orgs.js)

describe("orgs", function(){

  it("should list no orgs for a new account", function(done){
    sdk.orgs(creds, function(error, orgs){
      should.not.exist(error)
      orgs.should.eql([])
      return done()
    })
  })

  it("should refuse creating an org before the email is verified", function(done){
    sdk.orgCreate({ slug: "orgs-" + stamp }, creds, function(error, org){
      should.exist(error)
      error.should.have.property("status", 403)
      error.details.should.have.property("email")
      should.not.exist(org)
      return done()
    })
  })

  it("should not find an org the account isn't in", function(done){
    sdk.org("orgs-" + stamp, creds, function(error, org){
      should.exist(error)
      error.should.have.property("status", 404)
      error.details.should.have.property("org", "does not exist")
      sdk.orgRename("orgs-" + stamp, { name: "Nope" }, creds, function(error){
        error.should.have.property("status", 404)
        sdk.orgRemove("orgs-" + stamp, creds, function(error){
          error.should.have.property("status", 404)
          return done()
        })
      })
    })
  })

  it("should clean up", function(done){
    sdk.nuke(creds, function(error){
      should.not.exist(error)
      return done()
    })
  })

})

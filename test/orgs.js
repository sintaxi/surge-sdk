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
          sdk.orgMembers("orgs-" + stamp, creds, function(error){
            error.should.have.property("status", 404)
            return done()
          })
        })
      })
    })
  })

  // invites themselves (mint, claim, scrap) are slushi test/orgMembers.js
  it("should refuse an invite to an org the account isn't in", function(done){
    sdk.orgInvite("orgs-" + stamp, creds, function(error, invite){
      should.exist(error)
      error.should.have.property("status", 404)
      error.details.should.have.property("org", "does not exist")
      should.not.exist(invite)
      sdk.orgInvite("orgs-" + stamp, "admin", creds, function(error){
        error.should.have.property("status", 404)
        return done()
      })
    })
  })

  it("should refuse checking a code that isn't valid", function(done){
    sdk.claim("tiger00aaaaa", { check: true }, creds, function(error, rsp){
      should.exist(error)
      error.should.have.property("status", 404)
      should.not.exist(rsp)
      return done()
    })
  })

  it("should refuse scrapping a code that isn't valid", function(done){
    sdk.scrap("tiger00aaaaa", creds, function(error, rsp){
      should.exist(error)
      error.should.have.property("status", 404)
      error.messages[0].should.eql("that code isn't valid")
      should.not.exist(rsp)
      return done()
    })
  })

  it("should refuse joining with a code that isn't valid", function(done){
    sdk.orgJoin("orgs-" + stamp, "aaaa-bbbb-cccc-dddd", creds, function(error, org){
      should.exist(error)
      error.should.have.property("status", 404)
      error.details.should.have.property("invite", "is not valid")
      should.not.exist(org)
      return done()
    })
  })

  // transfer's wire shape; moves themselves are slushi test/transfer.js
  it("should refuse claiming with a code that isn't valid", function(done){
    sdk.claim("not-a-code", creds, function(error, rsp){
      should.exist(error)
      error.should.have.property("status", 404)
      error.messages[0].should.eql("that code isn't valid - ask for a new one")
      error.details.should.have.property("code", "is not valid")
      should.not.exist(rsp)
      return done()
    })
  })

  it("should refuse owner, transfer and codes on a domain the account doesn't hold", function(done){
    var domain = "orgs-" + stamp + "-nobody.surge.sh"
    sdk.owner(domain, creds, function(error){
      error.should.have.property("status", 403)
      sdk.transfer(domain, "acme", creds, function(error){
        error.should.have.property("status", 403)
        sdk.transferCode(domain, creds, function(error){
          error.should.have.property("status", 403)
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

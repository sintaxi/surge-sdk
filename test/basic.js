
var should      = require("should")
var sdkConfPath = process.env.sdkconf || "./config/sdk.json"
var sdkConf     = require(sdkConfPath)
var sdk         = require("../sdk")(sdkConf)
var stamp       = "t" + new Date().toJSON().split("-").join("").split(":").join("").split(".").join("")
var creds       = { user: stamp + "@chloi.io", pass: "secret" }

describe("basic", function(){
  var projectPath = __dirname + "/mocks/hello-world"
  var auth, accountObject;

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

  it("should fail to remove account with invalid token", function(done){
    sdk.nuke({ user: "token", pass: "123" }, function(error, account){
      should.exist(error)
      error.should.have.property("details")
      error.should.have.property("messages")
      error.should.have.property("status", 401)
      return done()      
    })
  })

})

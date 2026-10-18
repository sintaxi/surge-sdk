var should      = require("should")
var fs          = require("fs")
var os          = require("os")
var path        = require("path")
var crypto      = require("crypto")
var sdkConfPath = process.env.sdkconf || "./config/sdk.json"
var sdkConf     = require(sdkConfPath)

var stream      = require("../stream")
var sdk         = require("../sdk")(sdkConf, stream)
var stamp       = "t" + Date.now()

// carry against a real server (slushi plans/upload-dedupe.md): a
// republish sends only what changed, and the revision is the whole
// project. test/carry.js has the client's side in detail
describe("carried publish", function(){
  var creds  = { user: "carried-" + stamp + "@chloi.io", pass: "secret" }
  var domain = "carried-" + stamp + ".lvh.me"
  var root   = fs.mkdtempSync(path.join(os.tmpdir(), "surge-carried-"))
  var dir    = path.join(root, "project")
  var auth

  var write = function(name, content){
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true })
    fs.writeFileSync(path.join(dir, name), content)
  }

  // calls back with the carry event (if any), how many uploads the server
  // finished receiving (2 would mean a stale carry went again in full) and
  // the revision listed afterwards
  var publish = function(callback){
    var out = { carry: null, uploads: 0 }
    sdk.publish(dir, domain, auth, { "timestamp": new Date().toJSON() })
      .on("carry", function(c){ out.carry = c })
      .on("progress", function(p){ if (p.id === "upload" && p.end) out.uploads++ })
      .on("error", function(e){ callback(new Error(JSON.stringify(e))) })
      .on("fail", function(){ callback(new Error("publish failed")) })
      .on("success", function(){
        sdk.list(domain, auth, function(err, revisions){
          out.revision = revisions && revisions[0]
          callback(null, out)
        })
      })
  }

  before(function(done){
    write("video.bin", crypto.randomBytes(1200 * 1024))
    write("index.html", "<h1>" + stamp + "</h1>")
    write("css/app.css", "body{}")
    sdk.token(creds, function(errors, token){
      should.not.exist(errors)
      auth = token
      done()
    })
  })

  after(function(){ fs.rmSync(root, { recursive: true, force: true }) })

  it("uploads everything the first time", function(done){
    publish(function(err, out){
      should.not.exist(err)
      // a domain with no revision carries nothing, so there's no ticket
      should.not.exist(out.carry)
      out.uploads.should.equal(1)
      done()
    })
  })

  it("sends nothing when nothing changed", function(done){
    publish(function(err, out){
      should.not.exist(err)
      out.carry.should.eql({ carried: 3, sent: 0 })
      out.uploads.should.equal(1)
      done()
    })
  })

  it("sends only what changed", function(done){
    write("index.html", "<h1>changed " + stamp + "</h1>")
    write("new.txt", "new")
    publish(function(err, out){
      should.not.exist(err)
      out.carry.should.eql({ carried: 2, sent: 2 })
      out.uploads.should.equal(1)
      done()
    })
  })
})

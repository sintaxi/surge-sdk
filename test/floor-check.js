// exercises the real transport paths without mocha, so it can run on node
// 18.13 (the declared floor) where mocha 12's import attributes will not parse.
// the interesting one is publish: streamed tar up, ndjson down, which is the
// path that needs duplex:'half'.

var sdkFactory = require("../sdk/lib/sdk.js")
var stream     = require("../stream/lib/stream.js")

var sdk = sdkFactory({ endpoint: "http://localhost:5001", version: "999" }, stream)

var stamp = "t" + Date.now() + "n" + process.version.replace(/[^0-9]/g, "")
var creds = { user: stamp + "@chloi.io", pass: "secret" }
var domain = "floor-" + stamp + ".lvh.me"
var project = __dirname + "/mocks/hello-world"

var pass = 0
var fail = 0
var check = function(label, ok, detail){
  if (ok) { pass++; console.log("  ok   " + label) }
  else { fail++; console.log("  FAIL " + label + (detail ? " -> " + detail : "")) }
}

var auth = null

var steps = [
  function(next){
    sdk.account(creds, function(error, account){
      check("account create/fetch", !error && account && !!account.id, error && JSON.stringify(error))
      next()
    })
  },
  function(next){
    sdk.token(creds, function(error, token){
      auth = token
      check("token mint", !error && token && token.user === "token", error && JSON.stringify(error))
      next()
    })
  },
  function(next){
    // the whole point of the floor: streamed upload + progressive ndjson
    var seen = []
    var t0 = Date.now()
    sdk.publish(project, domain, auth, { cmd: "floor-check" }, {})
      .on("response", function(res){ seen.push("response:" + res.statusCode) })
      .on("progress", function(){ seen.push("progress") })
      .on("info", function(obj){ seen.push("info"); check("publish info has instances", !!obj.instances) })
      .on("success", function(){
        check("publish streamed upload + ndjson", seen.indexOf("info") !== -1, JSON.stringify(seen))
        check("publish emitted response event (D1)", seen.some(function(s){ return s.indexOf("response:200") === 0 }), JSON.stringify(seen))
        check("publish read ndjson progressively", seen.filter(function(s){ return s === "progress" }).length > 0, JSON.stringify(seen))
        console.log("       (" + seen.length + " events in " + (Date.now() - t0) + "ms)")
        next()
      })
      .on("fail", function(){ check("publish", false, "fail event: " + JSON.stringify(seen)); next() })
  },
  function(next){
    sdk.metadata(domain, auth, function(error, meta){
      // proves the tar framing survived byte for byte
      check("tar framing intact (publicTotalSize 21)", !error && meta && meta.publicTotalSize === 21,
        error ? JSON.stringify(error) : "got " + (meta && meta.publicTotalSize))
      check("cliVersion header round-tripped", meta && meta.cliVersion === "999", meta && meta.cliVersion)
      next()
    })
  },
  function(next){
    sdk.list(auth, function(error, projects){
      check("list", !error && Array.isArray(projects) && projects.length === 1, error && JSON.stringify(error))
      next()
    })
  },
  function(next){
    sdk.status(domain, auth, function(error, reply){
      check("status returns a word", !error && typeof reply.status === "string", error && JSON.stringify(error))
      next()
    })
  },
  function(next){
    // error shape: bad token must produce messages/details/status 401
    sdk.list({ user: "token", pass: "not-a-real-token" }, function(error){
      check("401 error shape", !!error && error.status === 401 && Array.isArray(error.messages),
        JSON.stringify(error))
      next()
    })
  },
  function(next){
    // unauthorized publish must emit the status event, not a bare fail
    var got = []
    sdk.publish(project, domain, { user: "token", pass: "nope" }, {}, {})
      .on("unauthorized", function(msg){ got.push(msg) })
      .on("fail", function(){
        check("unauthorized publish emits reason before fail", got.length === 1 && got[0] === "Unauthorized", JSON.stringify(got))
        next()
      })
  },
  function(next){
    sdk.teardown(domain, auth, function(error){
      check("teardown", !error, error && JSON.stringify(error))
      next()
    })
  },
  function(next){
    sdk.nuke(auth, function(error){
      check("nuke", !error, error && JSON.stringify(error))
      next()
    })
  }
]

console.log("node " + process.version + " — surge-sdk floor check")
var run = function(i){
  if (i >= steps.length){
    console.log("\n  " + pass + " passed, " + fail + " failed")
    process.exit(fail ? 1 : 0)
  }
  steps[i](function(){ run(i + 1) })
}
run(0)

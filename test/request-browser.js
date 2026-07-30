var should  = require("should")
var http    = require("http")
var execSync = require("child_process").execFileSync
var node    = require("../sdk/lib/request")
var browser = require("../sdk/lib/request.browser")

// the browser transport, exercised in node (which has fetch, btoa and
// TextEncoder as globals — the same primitives it uses in a browser).
//
// the point of these is parity: whatever the node build puts on the wire, the
// browser build must put there too, or the same call behaves differently
// depending on where it runs.

var serve = function(handler, callback){
  var srv = http.createServer(handler)
  srv.listen(0, function(){
    callback("http://localhost:" + srv.address().port, function(done){
      srv.closeAllConnections()
      srv.close(function(){ done() })
    })
  })
}

// runs both transports against the same server and hands back what it saw
var both = function(opts, handler, callback){
  var seen = []
  serve(function(req, res){
    var chunks = []
    req.on("data", function(c){ chunks.push(c) })
    req.on("end", function(){
      seen.push(handler(req, Buffer.concat(chunks)))
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end("{}")
    })
  }, function(base, close){
    var build = function(transport, next){
      var o = {}
      Object.keys(opts).forEach(function(k){ o[k] = opts[k] })
      o.url = base + (opts.path || "/x")
      transport(o, function(error, res){
        if (res && res.resume) res.resume()
        next()
      })
    }
    build(node, function(){
      build(browser, function(){
        close(function(){ callback(seen[0], seen[1]) })
      })
    })
  })
}

describe("request.browser", function(){

  it("should load with no node builtins available", function(){
    // a child process so the module-blocking cannot leak into the rest of the
    // suite. this is the check that the browser field is actually worth having.
    var script = [
      "var Module = require('module')",
      "var orig = Module._load",
      "var BUILTINS = ['http','https','url','fs','path','net','tls','zlib','stream','buffer','crypto','events']",
      "Module._load = function(req, parent){",
      "  var bare = String(req).replace(/^node:/, '')",
      "  if (BUILTINS.indexOf(bare) !== -1) throw new Error('node builtin required: ' + bare)",
      "  return orig.apply(this, arguments)",
      "}",
      "require(" + JSON.stringify(require.resolve("../sdk/lib/request.browser")) + ")",
      "console.log('clean')"
    ].join("\n")

    var out = execSync(process.execPath, ["-e", script], { encoding: "utf8" })
    out.trim().should.equal("clean")
  })

  it("should send the same basic auth header as the node build", function(done){
    both({ auth: { username: "token", password: "abc123" } }, function(req){
      return req.headers.authorization
    }, function(fromNode, fromBrowser){
      fromBrowser.should.equal(fromNode)
      return done()
    })
  })

  it("should match the node build on a non-ascii password", function(done){
    both({ auth: { username: "u@x.com", password: "pässwörd" } }, function(req){
      return req.headers.authorization
    }, function(fromNode, fromBrowser){
      // btoa alone would throw or mangle this; utf-8 first is what matches
      fromBrowser.should.equal(fromNode)
      Buffer.from(fromBrowser.split(" ")[1], "base64").toString("utf8").should.equal("u@x.com:pässwörd")
      return done()
    })
  })

  it("should match the node build on an empty password", function(done){
    both({ auth: { username: "token", password: undefined } }, function(req){
      return req.headers.authorization
    }, function(fromNode, fromBrowser){
      fromBrowser.should.equal(fromNode)
      Buffer.from(fromBrowser.split(" ")[1], "base64").toString("utf8").should.equal("token:")
      return done()
    })
  })

  it("should send the same method, body and content-type as the node build", function(done){
    both({
      method: "PUT",
      body: JSON.stringify({ plan: "professional-00" }),
      headers: { version: undefined, ssl: null, message: "ok" }
    }, function(req, body){
      return {
        method: req.method,
        contentType: req.headers["content-type"],
        message: req.headers.message,
        version: req.headers.version,
        ssl: req.headers.ssl,
        body: body.toString("utf8")
      }
    }, function(fromNode, fromBrowser){
      fromBrowser.should.eql(fromNode)
      should.not.exist(fromBrowser.version)
      should.not.exist(fromBrowser.ssl)
      return done()
    })
  })

  it("should read an empty body as an empty string", function(done){
    serve(function(req, res){
      res.writeHead(204)
      res.end()
    }, function(base, close){
      browser({ url: base + "/tokens/tok-abc", method: "DELETE" }, function(error, res, text){
        should.not.exist(error)
        res.statusCode.should.equal(204)
        text.should.equal("")
        return close(done)
      })
    })
  })

  it("should expose lowercased response headers", function(done){
    serve(function(req, res){
      res.writeHead(403, { "Reason": "nope", "Content-Type": "application/json" })
      res.end("{}")
    }, function(base, close){
      browser({ url: base + "/x" }, function(error, res){
        res.statusCode.should.equal(403)
        res.headers.should.have.property("reason", "nope")
        return close(done)
      })
    })
  })

  it("should report an unreachable endpoint as an error", function(done){
    browser({ url: "http://127.0.0.1:1/nope" }, function(error){
      should.exist(error)
      return done()
    })
  })

  it("should refuse a streaming request rather than pretend", function(done){
    browser({ url: "http://localhost:1/x", stream: true }, function(error){
      should.exist(error)
      error.message.should.match(/not supported in the browser/)
      return done()
    })
  })

  it("should join urls the same way the node build does", function(){
    browser.join("http://x.com/", "/stats").should.equal(node.join("http://x.com/", "/stats"))
    browser.join("http://x.com/api/", "/stats").should.equal("http://x.com/api/stats")
  })

  it("should let the whole sdk make a call with no node builtins", function(){
    // the actual claim, end to end: resolve ./request the way a bundler would
    // through the "browser" field, then take every node builtin away and run a
    // real request over global fetch.
    var script = [
      "var http = require('http')",                    // before the blockade
      "var srv = http.createServer(function(req, res){",
      "  res.writeHead(200, { 'Content-Type': 'application/json' })",
      "  res.end(JSON.stringify({ projects: '1', bytes: '2' }))",
      "})",
      "srv.listen(0, function(){",
      "  var port = srv.address().port",
      "  var browserTransport = require(" + JSON.stringify(require.resolve("../sdk/lib/request.browser")) + ")",
      "  var Module = require('module')",
      "  var orig = Module._load",
      "  var BUILTINS = ['http','https','url','fs','path','net','tls','zlib','stream','buffer','crypto','events']",
      "  Module._load = function(req, parent){",
      "    if (String(req) === './request') return browserTransport",   // the browser field
      "    var bare = String(req).replace(/^node:/, '')",
      "    if (BUILTINS.indexOf(bare) !== -1) throw new Error('node builtin required: ' + bare)",
      "    return orig.apply(this, arguments)",
      "  }",
      "  var sdk = require(" + JSON.stringify(require.resolve("../sdk/lib/sdk")) + ")({ endpoint: 'http://localhost:' + port })",
      "  sdk.stats(function(error, stats){",
      "    if (error) { console.log('FAILED ' + JSON.stringify(error)); process.exit(1) }",
      "    console.log(stats.projects === '1' ? 'clean' : 'unexpected ' + JSON.stringify(stats))",
      "    process.exit(0)",
      "  })",
      "})"
    ].join("\n")

    var out = execSync(process.execPath, ["-e", script], { encoding: "utf8" })
    out.trim().should.equal("clean")
  })

})

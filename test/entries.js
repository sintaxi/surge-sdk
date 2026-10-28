var should = require("should")
var http   = require("http")
var crypto = require("crypto")
var stream = require("../stream")
var tar    = require("tar")

// publishEntries: a project that lives in memory (a database, not a
// directory) goes up exactly as a directory does - the same tar, the same
// carry, the same events - and nothing touches the file system.

var sha = function(b){ return crypto.createHash("sha256").update(b).digest("hex") }

// a throwaway server, as in test/carry.js: carry(body) answers the carry
// request (an object, a status, or undefined for a 404); every PUT is read
// and answered success unless put(n, req, rsp, got) takes it
var server = function(opts, callback){
  var seen = { carry: [], puts: [] }
  var srv = http.createServer(function(req, rsp){
    if (req.method === "POST" && /\/carry$/.test(req.url)){
      var body = ""
      req.on("data", function(d){ body += d })
      req.on("end", function(){
        var parsed = JSON.parse(body)
        seen.carry.push({ headers: req.headers, files: parsed.files })
        var answer = opts.carry ? opts.carry(parsed) : undefined
        if (typeof answer === "number") return rsp.writeHead(answer).end()
        if (answer === undefined) return rsp.writeHead(404).end()
        rsp.writeHead(200, { "content-type": "application/json" })
        rsp.end(JSON.stringify(answer))
      })
      return
    }
    var n = seen.puts.length
    var got = { url: req.url, headers: req.headers, files: {}, modes: {} }
    seen.puts.push(got)
    if (opts.put && opts.put(n, req, rsp, got)) return
    read(req, got, function(){ rsp.end(JSON.stringify({ type: "info" }) + "\n") })
  })
  srv.listen(0, function(){ callback(srv, seen, "http://localhost:" + srv.address().port) })
}

var read = function(req, got, cb){
  var parser = new tar.Parser()
  parser.on("entry", function(entry){
    var c = []
    var name = entry.path.split("/").slice(1).join("/")
    got.modes[name] = entry.mode
    entry.on("data", function(d){ c.push(d) })
    entry.on("end", function(){ got.files[name] = Buffer.concat(c) })
  })
  parser.on("end", cb)
  req.pipe(parser)
}

var publish = function(endpoint, entries, headers, callback){
  var events = { list: [] }
  var em = stream({ endpoint: endpoint, version: "999" }).publishEntries(entries, "entries.lvh.me", "token", headers)
  ;["carry", "error", "data", "response"].forEach(function(e){
    em.on(e, function(p){ events.list.push(e); events[e] = p })
  })
  em.on("success", function(){ events.list.push("success"); callback(events) })
  em.on("fail", function(){ events.list.push("fail"); callback(events) })
}

var close = function(srv, done){ srv.closeAllConnections(); srv.close(function(){ done() }) }

var entry = function(name, content, extra){
  var bytes = Buffer.from(content)
  return Object.assign({ name: name, size: bytes.length, content: bytes }, extra || {})
}

describe("publishEntries", function(){

  it("packs files from memory under the project's path, with sizes in the headers", function(done){
    var page = new TextEncoder().encode("<h1>hi</h1>")
    var entries = [
      { name: "index.html", size: page.length, content: page },
      entry("css/app.css", "body{}"),
      entry("empty.txt", ""),
      entry("a/very/" + "long/".repeat(30) + "path.js", "export default 1\n"),
      entry("café.txt", "accent")
    ]
    server({}, function(srv, seen, endpoint){
      publish(endpoint, entries, { "known-org": "org_a" }, function(events){
        events.list.should.containEql("success")
        seen.puts.length.should.equal(1)
        seen.puts[0].url.should.equal("/entries.lvh.me")
        seen.puts[0].headers["content-type"].should.equal("application/gzip")
        seen.puts[0].headers["known-org"].should.equal("org_a")
        seen.puts[0].headers["file-count"].should.equal("5")
        seen.puts[0].headers["project-size"].should.equal(String(11 + 6 + 0 + entries[3].size + entries[4].size))
        Object.keys(seen.puts[0].files).sort().should.eql(entries.map(function(e){ return e.name }).sort())
        seen.puts[0].files["index.html"].toString().should.equal("<h1>hi</h1>")
        seen.puts[0].files["empty.txt"].length.should.equal(0)
        seen.puts[0].files[entries[3].name].toString().should.equal("export default 1\n")
        seen.puts[0].modes["css/app.css"].should.equal(0o644)
        close(srv, done)
      })
    })
  })

  it("reads content given as a function only when it is packed", function(done){
    var calls = 0
    var entries = [{ name: "index.html", size: 2, content: function(){ calls++; return Buffer.from("hi") } }]
    server({}, function(srv, seen, endpoint){
      publish(endpoint, entries, {}, function(events){
        events.list.should.containEql("success")
        calls.should.equal(1)
        seen.puts[0].files["index.html"].toString().should.equal("hi")
        close(srv, done)
      })
    })
  })

  it("asks carry with the hashes it is given, then uploads only what's missing", function(done){
    var big = crypto.randomBytes(1200 * 1024)
    var read = 0
    var entries = [
      { name: "video.bin", size: big.length, sha256: sha(big), content: function(){ read++; return big } },
      entry("index.html", "<h1>hi</h1>")
    ]
    server({ carry: function(){ return { ticket: "t1", missing: ["index.html"] } } }, function(srv, seen, endpoint){
      publish(endpoint, entries, {}, function(events){
        events.list.should.containEql("success")
        seen.carry[0].files.should.eql({
          "video.bin":  { sha256: sha(big), size: big.length },
          "index.html": { sha256: sha("<h1>hi</h1>"), size: 11 }
        })
        // the big file's hash came with it, and carry left it out of the upload
        read.should.equal(0)
        seen.puts[0].headers["carry-ticket"].should.equal("t1")
        seen.puts[0].headers["file-count"].should.equal("2")
        Object.keys(seen.puts[0].files).should.eql(["index.html"])
        events.carry.should.eql({ carried: 1, sent: 1 })
        close(srv, done)
      })
    })
  })

  it("publishes again in full when the carried upload goes stale", function(done){
    var big = crypto.randomBytes(1200 * 1024)
    var entries = [entry("video.bin", big), entry("index.html", "<h1>hi</h1>")]
    server({
      carry: function(){ return { ticket: "t1", missing: ["index.html"] } },
      put: function(n, req, rsp, got){
        if (n > 0) return false
        read(req, got, function(){
          rsp.end(JSON.stringify({ type: "error", error: { message: "Some files changed", carry: "stale" } }) + "\n")
        })
        return true
      }
    }, function(srv, seen, endpoint){
      publish(endpoint, entries, {}, function(events){
        events.list.should.containEql("success")
        seen.puts.length.should.equal(2)
        should.not.exist(seen.puts[1].headers["carry-ticket"])
        Object.keys(seen.puts[1].files).sort().should.eql(["index.html", "video.bin"])
        seen.puts[1].files["video.bin"].equals(big).should.be.true()
        close(srv, done)
      })
    })
  })

  it("fails the upload when content isn't the size its entry states", function(done){
    server({}, function(srv, seen, endpoint){
      publish(endpoint, [{ name: "index.html", size: 5, content: Buffer.from("hi") }], {}, function(events){
        events.list.should.containEql("fail")
        events.list.should.not.containEql("success")
        close(srv, done)
      })
    })
  })

  var refused = function(entries, message, done){
    var em = stream({ endpoint: "http://localhost:1", version: "999" }).publishEntries(entries, "entries.lvh.me", "token", {})
    var error
    em.on("error", function(e){ error = e })
    em.on("fail", function(){
      error.error.message.should.match(message)
      done()
    })
  }

  it("refuses entries without a relative path", function(done){
    refused([entry("../up.txt", "x")], /relative path/, done)
  })

  it("refuses two entries at one path", function(done){
    refused([entry("a.txt", "x"), entry("a.txt", "y")], /two entries are named a\.txt/, done)
  })

  it("refuses an entry without its size", function(done){
    refused([{ name: "a.txt", content: Buffer.from("x") }], /needs its size/, done)
  })
})

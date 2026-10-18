var should = require("should")
var http   = require("http")
var fs     = require("fs")
var os     = require("os")
var path   = require("path")
var crypto = require("crypto")
var stream = require("../stream")
var tar    = require("tar")

// upload dedupe (slushi plans/upload-dedupe.md): a project of 1MB or more
// asks POST /:domain/carry which files the server lacks and uploads only
// those, with the ticket. No ticket, an error or an older server: a full
// upload. A carried upload the server calls stale goes again in full, and
// the caller sees one publish.

var root

// a throwaway server. carry(body) answers the carry request: an object
// to send as JSON, a status number, or undefined for a 404. put(n, req,
// rsp, got) answers the nth PUT (0-based); by default it reads the upload
// and answers success
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
    var got = { headers: req.headers, files: {} }
    seen.puts.push(got)
    if (opts.put && opts.put(n, req, rsp, got)) return
    read(req, got, function(){ rsp.end(JSON.stringify({ type: "info" }) + "\n") })
  })
  srv.listen(0, function(){ callback(srv, seen, "http://localhost:" + srv.address().port) })
}

// the files in an upload, by path inside the project
var read = function(req, got, cb){
  var parser = new tar.Parser()
  parser.on("entry", function(entry){
    var c = []
    entry.on("data", function(d){ c.push(d) })
    entry.on("end", function(){ got.files[entry.path.split("/").slice(1).join("/")] = Buffer.concat(c) })
  })
  parser.on("end", cb)
  req.pipe(parser)
}

var stale = function(rsp){
  rsp.end(JSON.stringify({ type: "error", error: { message: "Some files changed", carry: "stale" } }) + "\n")
}

// publishes target; calls back with every event once the publish ends
var publish = function(endpoint, target, callback){
  var events = { list: [] }
  var em = stream({ endpoint: endpoint, version: "999" }).publish(target, "carry.lvh.me", "token", {})
  ;["carry", "error", "data", "single", "response"].forEach(function(e){
    em.on(e, function(p){ events.list.push(e); events[e] = p })
  })
  em.on("success", function(){ events.list.push("success"); callback(events) })
  em.on("fail", function(){ events.list.push("fail"); callback(events) })
}

var file = function(name, content){
  var p = path.join(root, "proj", name)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, content)
  return p
}

var sha = function(b){ return crypto.createHash("sha256").update(b).digest("hex") }

describe("carry", function(){
  var big

  beforeEach(function(){
    root = fs.mkdtempSync(path.join(os.tmpdir(), "surge-carry-"))
    big = crypto.randomBytes(1200 * 1024)
    file("video.bin", big)
    file("index.html", "<h1>hi</h1>")
    file("css/app.css", "body{}")
  })
  afterEach(function(){ fs.rmSync(root, { recursive: true, force: true }) })

  var close = function(srv, done){ srv.closeAllConnections(); srv.close(function(){ done() }) }

  it("lists every file, then uploads only what's missing, with the ticket", function(done){
    server({ carry: function(){ return { ticket: "t1", missing: ["index.html"] } } }, function(srv, seen, endpoint){
      publish(endpoint, path.join(root, "proj"), function(events){
        events.list.should.containEql("success")
        seen.carry.length.should.equal(1)
        seen.carry[0].files.should.eql({
          "video.bin":   { sha256: sha(big), size: big.length },
          "index.html":  { sha256: sha("<h1>hi</h1>"), size: 11 },
          "css/app.css": { sha256: sha("body{}"), size: 6 }
        })
        seen.carry[0].headers.version.should.equal("999")
        seen.puts.length.should.equal(1)
        seen.puts[0].headers["carry-ticket"].should.equal("t1")
        Object.keys(seen.puts[0].files).should.eql(["index.html"])
        // the headers still describe the whole project
        seen.puts[0].headers["file-count"].should.equal("3")
        seen.puts[0].headers["project-size"].should.equal(String(big.length + 11 + 6))
        events.carry.should.eql({ carried: 2, sent: 1 })
        close(srv, done)
      })
    })
  })

  it("uploads nothing when everything is carried", function(done){
    server({ carry: function(){ return { ticket: "t1", missing: [] } } }, function(srv, seen, endpoint){
      publish(endpoint, path.join(root, "proj"), function(events){
        events.list.should.containEql("success")
        seen.puts[0].files.should.eql({})
        seen.puts[0].headers["file-count"].should.equal("3")
        close(srv, done)
      })
    })
  })

  it("uploads everything without a ticket", function(done){
    server({ carry: function(b){ return { ticket: null, missing: Object.keys(b.files) } } }, function(srv, seen, endpoint){
      publish(endpoint, path.join(root, "proj"), function(events){
        events.list.should.containEql("success")
        should.not.exist(seen.puts[0].headers["carry-ticket"])
        Object.keys(seen.puts[0].files).sort().should.eql(["css/app.css", "index.html", "video.bin"])
        seen.puts[0].files["video.bin"].equals(big).should.be.true()
        should.not.exist(events.carry)
        close(srv, done)
      })
    })
  })

  it("uploads everything when the server has no carry", function(done){
    server({}, function(srv, seen, endpoint){
      publish(endpoint, path.join(root, "proj"), function(events){
        events.list.should.containEql("success")
        seen.carry.length.should.equal(1)
        should.not.exist(seen.puts[0].headers["carry-ticket"])
        Object.keys(seen.puts[0].files).length.should.equal(3)
        close(srv, done)
      })
    })
  })

  it("uploads everything when carry answers an error", function(done){
    server({ carry: function(){ return 429 } }, function(srv, seen, endpoint){
      publish(endpoint, path.join(root, "proj"), function(events){
        events.list.should.containEql("success")
        Object.keys(seen.puts[0].files).length.should.equal(3)
        close(srv, done)
      })
    })
  })

  it("doesn't ask for a project under 1MB", function(done){
    fs.rmSync(path.join(root, "proj", "video.bin"))
    server({ carry: function(){ return { ticket: "t1", missing: [] } } }, function(srv, seen, endpoint){
      publish(endpoint, path.join(root, "proj"), function(events){
        events.list.should.containEql("success")
        seen.carry.length.should.equal(0)
        Object.keys(seen.puts[0].files).sort().should.eql(["css/app.css", "index.html"])
        close(srv, done)
      })
    })
  })

  it("doesn't ask for a single file", function(done){
    var page = file("page.html", "<h1>" + "x".repeat(1100 * 1024) + "</h1>")
    server({ carry: function(){ return { ticket: "t1", missing: [] } } }, function(srv, seen, endpoint){
      publish(endpoint, page, function(events){
        events.list.should.containEql("success")
        seen.carry.length.should.equal(0)
        Object.keys(seen.puts[0].files).should.eql(["index.html"])
        close(srv, done)
      })
    })
  })

  it("publishes again in full when the carried upload goes stale", function(done){
    server({
      carry: function(){ return { ticket: "t1", missing: ["index.html"] } },
      put: function(n, req, rsp, got){
        if (n > 0) return false
        read(req, got, function(){ stale(rsp) })
        return true
      }
    }, function(srv, seen, endpoint){
      publish(endpoint, path.join(root, "proj"), function(events){
        events.list.filter(function(e){ return e === "success" || e === "fail" }).should.eql(["success"])
        events.list.should.not.containEql("error")
        should.not.exist(events.error)
        seen.puts.length.should.equal(2)
        seen.puts[0].headers["carry-ticket"].should.equal("t1")
        should.not.exist(seen.puts[1].headers["carry-ticket"])
        Object.keys(seen.puts[1].files).sort().should.eql(["css/app.css", "index.html", "video.bin"])
        seen.carry.length.should.equal(1)
        close(srv, done)
      })
    })
  })

  it("publishes again in full when the ticket is refused before the upload is read", function(done){
    server({
      carry: function(){ return { ticket: "t1", missing: ["video.bin", "index.html", "css/app.css"] } },
      put: function(n, req, rsp){
        if (n > 0) return false
        // answered while the client is still sending
        rsp.writeHead(200, { "content-type": "text/event-stream" })
        stale(rsp)
        return true
      }
    }, function(srv, seen, endpoint){
      publish(endpoint, path.join(root, "proj"), function(events){
        events.list.filter(function(e){ return e === "success" || e === "fail" }).should.eql(["success"])
        should.not.exist(events.error)
        seen.puts.length.should.equal(2)
        Object.keys(seen.puts[1].files).length.should.equal(3)
        close(srv, done)
      })
    })
  })

  it("goes again only once: a full upload's own errors reach the caller", function(done){
    server({
      carry: function(){ return { ticket: "t1", missing: [] } },
      put: function(n, req, rsp, got){
        read(req, got, function(){ stale(rsp) })
        return true
      }
    }, function(srv, seen, endpoint){
      publish(endpoint, path.join(root, "proj"), function(events){
        seen.puts.length.should.equal(2)
        events.list.should.containEql("fail")
        events.error.error.carry.should.equal("stale")
        close(srv, done)
      })
    })
  })

  it("uploads everything when a file can't be read for its hash", function(done){
    var p = file("locked.txt", "secret")
    fs.chmodSync(p, 0)
    var readable = true
    try { fs.readFileSync(p) } catch(e){ readable = false }
    if (readable){ fs.chmodSync(p, 0o644); return this.skip() }
    server({ carry: function(){ return { ticket: "t1", missing: [] } } }, function(srv, seen, endpoint){
      publish(endpoint, path.join(root, "proj"), function(events){
        fs.chmodSync(p, 0o644)
        seen.carry.length.should.equal(0)
        // the full upload then fails on the file, as it always has
        events.list.should.containEql("fail")
        close(srv, done)
      })
    })
  })
})

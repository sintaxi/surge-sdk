var should = require("should")
var http   = require("http")
var fs     = require("fs")
var os     = require("os")
var path   = require("path")
var zlib   = require("zlib")
var crypto = require("crypto")
var stream = require("../stream")
var tar    = require("tar")

// the stream packs with its own writer (stream/lib/pack.js). The contract:
// the upload is byte for byte what node-tar 7 produced before
// (tar.c({ gzip, portable, follow, mtime: epoch })), so the server sees
// nothing new. Checked on the published body itself, raw tar and gzip.

var root

// a tree that exercises every header path: an empty file, a binary bigger
// than one block, unicode and CJK names (PAX), a 40-deep path, a path that
// needs the USTAR prefix split, one too long for it (PAX), paths of exactly
// 99 and 100 bytes, and modes node-tar's portable rule rewrites
var tree = function(){
  var t = {
    "index.html": "<h1>hi</h1>",
    "empty.txt": "",
    "css/app.css": "body{}",
    "naïve/café ☕.html": "unicode",
    "日本語/ファイル.txt": "cjk",
    "script.sh": "#!/bin/sh\n",
    "bin/blob.bin": crypto.randomBytes(1024 * 1024 + 17)
  }
  t["deep/" + "a/".repeat(40) + "leaf.txt"] = "deep"
  t["long/" + "x".repeat(150) + "/" + "y".repeat(90) + ".html"] = "prefix split"
  t["toolong/" + "z".repeat(240) + ".html"] = "pax"
  t["exact/" + "q".repeat(88)] = "99 bytes with the dir name"
  t["exact2/" + "r".repeat(88)] = "100 bytes with the dir name"
  return t
}

var build = function(name, files){
  var dir = path.join(root, name)
  Object.keys(files).forEach(function(p){
    var f = path.join(dir, p)
    fs.mkdirSync(path.dirname(f), { recursive: true })
    fs.writeFileSync(f, files[p])
  })
  return dir
}

// publishes to a throwaway server and calls back with the body it received
var published = function(dir, opts, callback){
  var chunks = []
  var srv = http.createServer(function(req, res){
    req.on("data", function(c){
      chunks.push(c)
      // a slow reader: the stream has to wait for it, not buffer the project
      if (opts.slow){
        req.pause()
        setTimeout(function(){ req.resume() }, 1)
      }
    })
    req.on("end", function(){ res.end(JSON.stringify({ type: "info" }) + "\n") })
  })
  srv.listen(0, function(){
    stream({ endpoint: "http://localhost:" + srv.address().port, version: "999" })
      .publish(dir, "pack.lvh.me", "token", {})
      .on("success", function(){
        srv.closeAllConnections()
        srv.close(function(){ callback(null, Buffer.concat(chunks)) })
      })
      .on("fail", function(){
        srv.closeAllConnections()
        srv.close(function(){ callback(new Error("publish failed")) })
      })
  })
}

// what node-tar 7 makes of the same directory, in the stream's file order
var reference = function(dir, gzip, callback){
  var files = []
  ;(function walk(d, pre){
    fs.readdirSync(d).forEach(function(e){
      var full = path.join(d, e), rel = pre ? pre + "/" + e : e
      fs.statSync(full).isDirectory() ? walk(full, rel) : files.push(rel)
    })
  })(dir, "")
  var name = path.basename(dir)
  var out = []
  tar.c({ gzip: gzip, cwd: path.dirname(dir), portable: true, follow: true, mtime: new Date(0) },
    files.map(function(f){ return name + "/" + f }))
    .on("data", function(c){ out.push(c) })
    .on("end", function(){ callback(Buffer.concat(out)) })
}

describe("pack", function(){

  before(function(){ root = fs.mkdtempSync(path.join(os.tmpdir(), "surge-pack-")) })
  after(function(){ fs.rmSync(root, { recursive: true, force: true }) })

  it("uploads exactly the tar node-tar 7 wrote", function(done){
    var dir = build("site", tree())
    fs.chmodSync(path.join(dir, "script.sh"), 0o755)
    fs.chmodSync(path.join(dir, "css", "app.css"), 0o664)
    published(dir, {}, function(err, body){
      should.not.exist(err)
      reference(dir, false, function(raw){
        Buffer.compare(zlib.gunzipSync(body), raw).should.equal(0)
        reference(dir, true, function(gz){
          Buffer.compare(body, gz).should.equal(0)
          done()
        })
      })
    })
  })

  it("streams a large file to a slow reader intact", function(done){
    var big = crypto.randomBytes(8 * 1024 * 1024)
    var dir = build("big", { "index.html": "x", "big.bin": big })
    published(dir, { slow: true }, function(err, body){
      should.not.exist(err)
      var found = null
      var parser = new tar.Parser()
      parser.on("entry", function(entry){
        var c = []
        entry.on("data", function(d){ c.push(d) })
        entry.on("end", function(){ if (entry.path === "big/big.bin") found = Buffer.concat(c) })
      })
      parser.on("end", function(){
        should.exist(found)
        Buffer.compare(found, big).should.equal(0)
        done()
      })
      parser.end(body)
    })
  })

  // a file that changes between the stat and the read: as node-tar did, it
  // goes for exactly the size its header states. An agent rewriting the
  // project mid-publish grows files; a shrink can't be framed, so it fails
  var changeAfterStat = function(target, change){
    var real = fs.stat
    fs.stat = function(p, cb){
      real.call(fs, p, function(err, st){
        if (p === target) change(target)
        cb(err, st)
      })
    }
    return function(){ fs.stat = real }
  }

  it("sends a file that grows mid-publish as it was at the stat", function(done){
    var dir = build("grows", { "index.html": "x", "log.txt": "first" })
    var restore = changeAfterStat(path.join(dir, "log.txt"), function(f){ fs.appendFileSync(f, " and more") })
    published(dir, {}, function(err, body){
      restore()
      should.not.exist(err)
      var got = null
      var parser = new tar.Parser()
      parser.on("entry", function(entry){
        var c = []
        entry.on("data", function(d){ c.push(d) })
        entry.on("end", function(){ if (entry.path === "grows/log.txt") got = Buffer.concat(c).toString() })
      })
      parser.on("end", function(){
        should(got).equal("first")
        done()
      })
      parser.end(body)
    })
  })

  it("fails the publish when a file shrinks mid-publish", function(done){
    var dir = build("shrinks", { "index.html": "x", "log.txt": "a longer first version" })
    var restore = changeAfterStat(path.join(dir, "log.txt"), function(f){ fs.writeFileSync(f, "short") })
    published(dir, {}, function(err){
      restore()
      should.exist(err)
      done()
    })
  })

  // node-tar threw on an empty file list ("no paths specified"), so an
  // empty project threw inside publish; now it uploads an empty archive and
  // the server answers "the project is empty"
  it("packs an empty project as just the end blocks", function(done){
    var dir = path.join(root, "nothing")
    fs.mkdirSync(dir)
    published(dir, {}, function(err, body){
      should.not.exist(err)
      Buffer.compare(zlib.gunzipSync(body), Buffer.alloc(1024)).should.equal(0)
      body[9].should.equal(255)
      done()
    })
  })
})

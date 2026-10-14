var should = require("should")
var http   = require("http")
var fs     = require("fs")
var os     = require("os")
var path   = require("path")
var stream = require("../stream")
var tar    = require(require.resolve("tar", { paths: [path.join(__dirname, "../stream")] }))

// symlinks in a project, against a throwaway server that unpacks what the
// stream sends. the contract: links are resolved client side and arrive as
// regular files carrying their target's content; anything that resolves to
// nothing is skipped and reported on the "skipped" event, never thrown.
//
// fixtures are built at test time — committed symlinks do not survive every
// checkout (windows, zip downloads).

var root

var project = function(name, build){
  var dir = path.join(root, name, "proj")
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, "index.html"), "index")
  build(dir)
  return dir
}

// publishes the project and calls back with { files: {path: content},
// types: [entry types], skipped: [paths] }
var publish = function(dir, callback){
  var result = { files: {}, types: [], skipped: [] }
  var srv = http.createServer(function(req, res){
    var parser = new tar.Parser()
    parser.on("entry", function(entry){
      var chunks = []
      result.types.push(entry.type)
      entry.on("data", function(c){ chunks.push(c) })
      entry.on("end", function(){
        result.files[entry.path.split("/").slice(1).join("/")] = Buffer.concat(chunks).toString()
      })
    })
    req.pipe(parser)
    parser.on("end", function(){
      res.end(JSON.stringify({ type: "info" }) + "\n")
    })
  })
  srv.listen(0, function(){
    stream({ endpoint: "http://localhost:" + srv.address().port, version: "999" })
      .publish(dir, "symlinks.lvh.me", "token", {})
      .on("skipped", function(paths){ result.skipped = paths })
      .on("success", function(){
        srv.closeAllConnections()
        srv.close(function(){ callback(result) })
      })
  })
}

describe("symlinks", function(){

  before(function(){
    root = fs.mkdtempSync(path.join(os.tmpdir(), "surge-symlinks-"))
  })

  after(function(){
    fs.rmSync(root, { recursive: true, force: true })
  })

  it("should pack a file link as its target's content", function(done){
    var dir = project("file-alias", function(dir){
      fs.mkdirSync(path.join(dir, "sub"))
      fs.symlinkSync("index.html", path.join(dir, "alias.html"))
      fs.symlinkSync("../index.html", path.join(dir, "sub", "a.html"))
    })
    publish(dir, function(result){
      result.files.should.eql({ "index.html": "index", "alias.html": "index", "sub/a.html": "index" })
      result.types.should.matchEach("File")
      result.skipped.should.eql([])
      done()
    })
  })

  it("should pack links that point outside the project or are absolute", function(done){
    var outside = path.join(root, "outside")
    fs.mkdirSync(path.join(outside, "assets"), { recursive: true })
    fs.writeFileSync(path.join(outside, "shared.css"), "shared")
    fs.writeFileSync(path.join(outside, "assets", "logo.svg"), "logo")
    var dir = project("outside", function(dir){
      fs.symlinkSync(path.join(outside, "shared.css"), path.join(dir, "shared.css"))
      fs.symlinkSync("../../outside/assets", path.join(dir, "assets"))
    })
    publish(dir, function(result){
      result.files.should.eql({ "index.html": "index", "shared.css": "shared", "assets/logo.svg": "logo" })
      result.types.should.matchEach("File")
      done()
    })
  })

  it("should follow a directory link inside the project", function(done){
    var dir = project("dir-alias", function(dir){
      fs.mkdirSync(path.join(dir, "v2"))
      fs.writeFileSync(path.join(dir, "v2", "page.html"), "v2")
      fs.symlinkSync("v2", path.join(dir, "latest"))
    })
    publish(dir, function(result){
      result.files.should.eql({ "index.html": "index", "v2/page.html": "v2", "latest/page.html": "v2" })
      done()
    })
  })

  it("should skip and report a dangling link", function(done){
    var dir = project("dangling", function(dir){
      fs.symlinkSync("missing.html", path.join(dir, "broken.html"))
    })
    publish(dir, function(result){
      result.files.should.eql({ "index.html": "index" })
      result.skipped.should.eql(["broken.html"])
      done()
    })
  })

  it("should skip an ignored dangling link without reporting it", function(done){
    // emacs lock files are dangling links by design
    var dir = project("lockfile", function(dir){
      fs.symlinkSync("user@host.123:456", path.join(dir, ".#index.html"))
    })
    publish(dir, function(result){
      result.files.should.eql({ "index.html": "index" })
      result.skipped.should.eql([])
      done()
    })
  })

  it("should skip and report links that loop", function(done){
    var dir = project("loops", function(dir){
      fs.mkdirSync(path.join(dir, "a"))
      fs.writeFileSync(path.join(dir, "a", "deep.html"), "deep")
      fs.symlinkSync(".", path.join(dir, "self"))
      fs.symlinkSync("..", path.join(dir, "a", "up"))
      fs.symlinkSync("ping", path.join(dir, "pong"))
      fs.symlinkSync("pong", path.join(dir, "ping"))
    })
    publish(dir, function(result){
      result.files.should.eql({ "index.html": "index", "a/deep.html": "deep" })
      result.skipped.slice().sort().should.eql(["a/up", "ping", "pong", "self"])
      done()
    })
  })

  it("should keep a directory reincluded with a trailing slash", function(done){
    var dir = project("well-known", function(dir){
      fs.mkdirSync(path.join(dir, ".well-known"))
      fs.writeFileSync(path.join(dir, ".well-known", "token"), "token")
      fs.writeFileSync(path.join(dir, ".surgeignore"), "!.well-known/\n")
    })
    publish(dir, function(result){
      result.files.should.eql({ "index.html": "index", ".well-known/token": "token" })
      done()
    })
  })

  if (process.platform !== "win32") {
    it("should skip and report a fifo rather than hang on it", function(done){
      var dir = project("fifo", function(dir){
        require("child_process").execFileSync("mkfifo", [path.join(dir, "pipe")])
      })
      publish(dir, function(result){
        result.files.should.eql({ "index.html": "index" })
        result.skipped.should.eql(["pipe"])
        done()
      })
    })
  }

})

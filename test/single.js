var should = require("should")
var http   = require("http")
var fs     = require("fs")
var os     = require("os")
var path   = require("path")
var stream = require("../stream")
var tar    = require("tar")

// a project of exactly one file publishes at the root (slushi
// plans/single-file.md): an html page as index.html. Any other single file
// is refused before a request is made, in the shape a server refusal
// arrives in. The "single" event says what happened.

var root

// publishes to a throwaway server; calls back with what arrived (files by
// path, request headers, whether a request came at all) and every event
var publish = function(target, headers, callback){
  var got = { requested: false, files: {}, headers: null }, events = {}
  var srv = http.createServer(function(req, res){
    got.requested = true
    got.headers = req.headers
    var parser = new tar.Parser()
    parser.on("entry", function(entry){
      var c = []
      entry.on("data", function(d){ c.push(d) })
      entry.on("end", function(){ got.files[entry.path.split("/").slice(1).join("/")] = Buffer.concat(c).toString() })
    })
    req.pipe(parser)
    parser.on("end", function(){ res.end(JSON.stringify({ type: "info" }) + "\n") })
  })
  srv.listen(0, function(){
    var finish = function(){
      srv.closeAllConnections()
      srv.close(function(){ callback(got, events) })
    }
    var em = stream({ endpoint: "http://localhost:" + srv.address().port, version: "999" })
      .publish(target, "single.lvh.me", "token", headers)
    ;["single", "skipped", "error"].forEach(function(e){ em.on(e, function(p){ events[e] = p }) })
    em.on("success", function(){ events.success = true; finish() })
    em.on("fail", function(){ events.fail = true; finish() })
  })
}

var file = function(name, content){
  var p = path.join(root, name)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, content)
  return p
}

describe("single file", function(){

  beforeEach(function(){ root = fs.mkdtempSync(path.join(os.tmpdir(), "surge-single-")) })
  afterEach(function(){ fs.rmSync(root, { recursive: true, force: true }) })

  it("publishes an html page as index.html", function(done){
    publish(file("page.html", "<h1>hi</h1>"), {}, function(got, events){
      events.success.should.be.true()
      got.files.should.eql({ "index.html": "<h1>hi</h1>" })
      events.single.should.eql({ file: "page.html", as: "index.html", local: [] })
      done()
    })
  })

  it("takes .htm in any case", function(done){
    publish(file("OLD.HTM", "<p>x</p>"), {}, function(got, events){
      got.files.should.eql({ "index.html": "<p>x</p>" })
      events.single.as.should.equal("index.html")
      done()
    })
  })

  it("lists the files the page uses that it leaves behind", function(done){
    file("site/style.css", "body{}")
    file("site/img/logo.png", "png")
    var page = file("site/index.html", [
      '<link rel="stylesheet" href="style.css?v=2">',
      '<img src="img/logo.png">',
      '<img src="/img/logo.png">',
      '<script src="missing.js"></script>',
      '<script src="https://cdn.example.com/x.js"></script>',
      '<a href="//example.com/">x</a>',
      '<a href="#top">top</a>',
      '<a href="mailto:a@b.c">mail</a>'
    ].join("\n"))
    publish(page, {}, function(got, events){
      events.single.local.should.eql(["style.css", "img/logo.png"])
      Object.keys(got.files).should.eql(["index.html"])
      done()
    })
  })

  it("refuses any other single file without a request", function(done){
    publish(file("report.pdf", "%PDF-1.4"), {}, function(got, events){
      got.requested.should.be.false()
      events.fail.should.be.true()
      events.error.should.eql({ error: { message: "A project is a directory - put report.pdf in a folder and publish the folder." } })
      should.not.exist(events.single)
      done()
    })
  })

  it("states file-count and project-size when the caller doesn't", function(done){
    publish(file("page.html", "<h1>twelve</h1>"), {}, function(got){
      got.headers["file-count"].should.equal("1")
      got.headers["project-size"].should.equal("15")
      done()
    })
  })

  it("keeps the counts a caller passes", function(done){
    publish(file("page.html", "<h1>x</h1>"), { "file-count": "7", "project-size": "99" }, function(got){
      got.headers["file-count"].should.equal("7")
      got.headers["project-size"].should.equal("99")
      done()
    })
  })

  it("leaves a directory's events as they were", function(done){
    var dir = path.join(root, "proj")
    file("proj/index.html", "x")
    publish(dir, {}, function(got, events){
      got.files.should.eql({ "index.html": "x" })
      should.not.exist(events.single)
      got.headers["file-count"].should.equal("1")
      done()
    })
  })
})

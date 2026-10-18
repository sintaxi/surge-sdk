var should = require("should")
var vm     = require("vm")
var fs     = require("fs")
var path   = require("path")
var project = require("../stream/lib/project")

// the rules every client shares (stream/lib/project.js) and the format
// writer (stream/lib/pack.js) must run where only a browser's globals
// exist: a drop page imports them as they are (slushi plans/drop.md)
describe("project rules", function(){

  ;["project.js", "pack.js"].forEach(function(file){
    it(file + " loads with no process, Buffer or fs", function(){
      var src = fs.readFileSync(path.join(__dirname, "..", "stream", "lib", file), "utf8")
      var mod = { exports: {} }
      vm.runInNewContext(src, {
        module: mod, exports: mod.exports, TextEncoder: TextEncoder,
        require: function(name){ return require(require.resolve(name, { paths: [path.join(__dirname, "..", "stream")] })) }
      })
      Object.keys(mod.exports).length.should.be.above(0)
    })
  })

  it("publishes a lone html page at the root, and refuses other files", function(){
    project.single("page.html").should.eql({ as: "index.html" })
    project.single("OLD.HTM").should.eql({ as: "index.html" })
    project.single("report.pdf").should.eql({ refused: "A project is a directory - put report.pdf in a folder and publish the folder." })
  })

  it("ignores surge's defaults, plus a .surgeignore", function(){
    var ig = project.ignorer("drafts/\n")
    ig.ignores(".git").should.be.true()
    ig.ignores("node_modules").should.be.true()
    ig.ignores("drafts/a.html").should.be.true()
    ig.ignores("index.html").should.be.false()
    project.ignorer(null).ignores("drafts/a.html").should.be.false()
  })

  it("finds the relative files a page uses", function(){
    project.references([
      '<link href="css/app.css?v=3">', '<img src="/img/a b.png">', '<img src="/img/a%20b.png">',
      '<script src="https://cdn.example.com/x.js"></script>', '<a href="//example.com">',
      '<a href="#top">', '<a href="mailto:x@y.z">', '<a href="data:text/plain,hi">'
    ].join("")).should.eql(["css/app.css", "img/a b.png"])
  })
})

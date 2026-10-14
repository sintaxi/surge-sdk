var should = require("should")
var http   = require("http")
var sdk    = require("../sdk")

// error shaping, against a throwaway server rather than slushi — these paths
// are reachable in production (an html 404 from an unknown route, a body-less
// 5xx, an endpoint that redirects) but the real api never produces them on the
// routes the suite exercises, so nothing else covers them.
//
// the contract every consumer depends on: the error handed to a callback is a
// plain object carrying messages/details/status. before this, a non-json error
// body arrived as a bare string and an empty one arrived as "" — which is
// falsy, so `if (error)` missed it and a 500 read as success.

var serve = function(handler, callback){
  var srv = http.createServer(handler)
  srv.listen(0, function(){
    var api = sdk({ endpoint: "http://localhost:" + srv.address().port })
    callback(api, function(done){
      srv.closeAllConnections()
      srv.close(function(){ done() })
    })
  })
}

describe("errors", function(){

  it("should shape an html error body into messages/details/status", function(done){
    serve(function(req, res){
      res.writeHead(404, { "Content-Type": "text/html" })
      res.end("<html><body>404 – Page not found</body></html>")
    }, function(api, close){
      api.stats(function(error){
        should.exist(error)
        error.should.be.an.Object()
        error.should.have.property("status", 404)
        error.messages.should.be.an.Array()
        error.should.have.property("details")
        return close(done)
      })
    })
  })

  it("should not let a body-less error read as success", function(done){
    serve(function(req, res){
      res.writeHead(500)
      res.end()
    }, function(api, close){
      api.stats(function(error, data){
        // the regression this guards: error === "" is falsy
        should.exist(error)
        Boolean(error).should.equal(true)
        error.should.have.property("status", 500)
        should.not.exist(data)
        return close(done)
      })
    })
  })

  it("should pass a json error body through with the status stamped on", function(done){
    serve(function(req, res){
      res.writeHead(422, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ messages: ["domain must be present"], details: { domain: "required" } }))
    }, function(api, close){
      api.stats(function(error){
        error.should.have.property("status", 422)
        error.messages.should.containEql("domain must be present")
        error.details.should.have.property("domain", "required")
        return close(done)
      })
    })
  })

  it("should report a redirect rather than follow it", function(done){
    // node only (the browser still follows, and strips the header itself).
    // following is what leaked: node <= 18.13 fetch sends the authorization
    // header on to a cross-origin redirect target. no api route redirects an
    // sdk call, so nothing relied on following.
    var moved = false
    serve(function(req, res){
      if (req.url === "/stats"){
        res.writeHead(302, { "Location": "/moved" })
        return res.end()
      }
      moved = true
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ projects: "7" }))
    }, function(api, close){
      api.stats(function(error, stats){
        should.exist(error)
        error.should.have.property("status", 302)
        error.messages.should.eql(["endpoint redirected (302)"])
        moved.should.equal(false)
        return close(done)
      })
    })
  })

  it("should not carry credentials to a cross-origin redirect target", function(done){
    var reached = false
    var other = http.createServer(function(req, res){
      reached = req.headers.authorization || true
      res.end("{}")
    })
    other.listen(0, function(){
      serve(function(req, res){
        res.writeHead(307, { "Location": "http://127.0.0.1:" + other.address().port + "/account" })
        res.end()
      }, function(api, close){
        api.account({ user: "someone@example.com", pass: "secret" }, function(error){
          should.exist(error)
          error.should.have.property("status", 307)
          reached.should.equal(false)
          other.close()
          return close(done)
        })
      })
    })
  })

  it("should report an unreachable endpoint with messages", function(done){
    // port 1 is privileged and unbound
    var api = sdk({ endpoint: "http://127.0.0.1:1" })
    api.stats(function(error){
      should.exist(error)
      error.messages.should.be.an.Array().and.have.length(1)
      error.should.have.property("details")
      return done()
    })
  })

  it("should keep a body field named status out of harm's way", function(done){
    serve(function(req, res){
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ status: "live", https: false, via: null }))
    }, function(api, close){
      api.stats(function(error, reply){
        should.not.exist(error)
        // the server's own status word, not an http code
        reply.status.should.equal("live")
        reply.https.should.equal(false)
        should(reply.via).equal(null)
        return close(done)
      })
    })
  })

})

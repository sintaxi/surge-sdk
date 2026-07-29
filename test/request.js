var should  = require("should")
var http    = require("http")
var request = require("../sdk/lib/request")

// unit tests for the transport that replaced axios. these talk to a throwaway
// server on localhost, so unlike the rest of the suite they need neither
// slushi nor a publish budget.
//
// the two traps below are the ones that bite immediately: node throws on an
// undefined header value where axios dropped it, and a naive credential concat
// puts the literal string "undefined" on the wire as the password.

var serve = function(handler, callback){
  var srv = http.createServer(handler)
  srv.listen(0, function(){
    callback("http://localhost:" + srv.address().port, function(done){
      srv.closeAllConnections()
      srv.close(function(){ done() })
    })
  })
}

describe("request", function(){

  it("should drop undefined and null header values", function(done){
    serve(function(req, res){
      req.headers.should.not.have.property("version")
      req.headers.should.not.have.property("ssl")
      req.headers.should.have.property("message", "ok")
      res.end("{}")
    }, function(base, close){
      request({
        url: base + "/publish",
        method: "PUT",
        headers: { version: undefined, ssl: null, message: "ok" },
        body: JSON.stringify({ a: 1 })
      }, function(error, res){
        should.not.exist(error)
        res.resume()
        return close(done)
      })
    })
  })

  it("should send an empty password rather than the string undefined", function(done){
    var seen = null
    serve(function(req, res){
      seen = Buffer.from(req.headers.authorization.split(" ")[1], "base64").toString("utf8")
      res.end("{}")
    }, function(base, close){
      request({
        url: base + "/account",
        auth: { username: "a@b.com", password: undefined }
      }, function(error, res){
        res.resume()
        seen.should.equal("a@b.com:")
        return close(done)
      })
    })
  })

  it("should encode credentials as utf-8", function(done){
    var seen = null
    serve(function(req, res){
      seen = Buffer.from(req.headers.authorization.split(" ")[1], "base64").toString("utf8")
      res.end("{}")
    }, function(base, close){
      request({
        url: base + "/account",
        auth: { username: "u@x.com", password: "pässwörd" }
      }, function(error, res){
        res.resume()
        seen.should.equal("u@x.com:pässwörd")
        return close(done)
      })
    })
  })

  it("should set json content-type and length for a body", function(done){
    serve(function(req, res){
      req.headers.should.have.property("content-type", "application/json")
      req.headers.should.have.property("content-length", "7")
      res.end("{}")
    }, function(base, close){
      request({
        url: base + "/plan",
        method: "PUT",
        body: JSON.stringify({ a: 1 })
      }, function(error, res){
        res.resume()
        return close(done)
      })
    })
  })

  it("should read an empty body as an empty string", function(done){
    serve(function(req, res){
      res.writeHead(204)
      res.end()
    }, function(base, close){
      request({ url: base + "/tokens/tok-abc", method: "DELETE" }, function(error, res, body){
        should.not.exist(error)
        res.statusCode.should.equal(204)
        body.should.equal("")
        return close(done)
      })
    })
  })

  it("should report a refused connection exactly once", function(done){
    var calls = 0

    // port 1 is privileged and unbound — nothing will answer
    request({ url: "http://127.0.0.1:1/nope" }, function(error){
      calls++
      should.exist(error)
      error.should.have.property("code")
    })

    setTimeout(function(){
      calls.should.equal(1)
      return done()
    }, 300)
  })

  it("should join an endpoint and path the way axios joined baseURL", function(){
    var join = request.join
    join("http://x.com", "/stats").should.equal("http://x.com/stats")
    join("http://x.com/", "/stats").should.equal("http://x.com/stats")
    join("http://x.com/", "stats").should.equal("http://x.com/stats")
    join("http://x.com", "/dom.surge.sh/status").should.equal("http://x.com/dom.surge.sh/status")

    // an endpoint carrying a path keeps it — url.resolve would drop "/api"
    join("http://x.com/api/", "/stats").should.equal("http://x.com/api/stats")
  })

})

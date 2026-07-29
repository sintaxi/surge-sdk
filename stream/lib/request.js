
var http  = require("http")
var https = require("https")
var url   = require("url")

// resolves to this package's own manifest, so the identical file reports
// surge-sdk in one copy and surge-stream in the other
var pkg = require("../package.json")

// minimal http(s) client, in place of axios. the behaviours reproduced here
// were measured off axios 1.18.1 on the wire, not read from its docs — see
// slushi/plans/drop-axios.md for the capture.

var once = function(fn){
  var called = false
  return function(){
    if (called) return
    called = true
    return fn.apply(null, arguments)
  }
}

// node throws ERR_HTTP_INVALID_HEADER_VALUE (synchronously) on an undefined
// header value where axios silently drops it. the cli relies on that: it never
// sets config.version, and sends stage/message/add/rem as undefined whenever
// the flag is absent, plus ssl as null on every publish.
var clean = function(headers){
  var out = {}
  Object.keys(headers || {}).forEach(function(key){
    var value = headers[key]
    if (value === undefined || value === null) return
    out[key] = value
  })
  return out
}

// the || "" coercion is load bearing. "token" + ":" + undefined would put the
// literal string "undefined" on the wire as the password; axios encodes a
// missing field as empty. with the coercion node's auth option is byte
// identical to axios, utf-8 and all.
var credentials = function(auth){
  if (!auth) return undefined
  return (auth.username || "") + ":" + (auth.password || "")
}

// axios baseURL semantics: one slash between the two, never zero and never
// two. note this is NOT url.resolve, which drops the last path segment of an
// endpoint that carries a path.
var join = function(endpoint, path){
  if (/^https?:\/\//i.test(path)) return path
  return String(endpoint).replace(/\/+$/, "") + "/" + String(path).replace(/^\/+/, "")
}

var collect = function(res, callback){
  var chunks = []
  res.on("data", function(chunk){ chunks.push(chunk) })
  res.on("end", function(){ callback(null, Buffer.concat(chunks).toString("utf8")) })
  res.on("error", callback)
}

// opts: { url, method, headers, body, auth, stream }
// body may be a string or a readable stream. with stream:true the response is
// handed over unread, for the ndjson handshakes to pipe.
var request = function(opts, callback){
  var done      = once(callback)
  var target    = url.parse(opts.url)
  var transport = target.protocol === "https:" ? https : http
  var headers   = clean(opts.headers)
  var body      = opts.body
  var streaming = body !== undefined && body !== null && typeof body.pipe === "function"

  if (body !== undefined && body !== null && !streaming){
    if (!headers["content-type"]) headers["content-type"] = "application/json"
    headers["content-length"] = Buffer.byteLength(body)
  }

  if (!headers["user-agent"]) headers["user-agent"] = pkg.name + "/" + pkg.version

  var req = transport.request({
    protocol: target.protocol,
    hostname: target.hostname,
    port:     target.port,
    path:     target.path,
    method:   opts.method || "GET",
    headers:  headers,
    auth:     credentials(opts.auth)
  }, function(res){
    if (opts.stream) return done(null, res)
    collect(res, function(error, text){
      if (error) return done(error)
      return done(null, res, text)
    })
  })

  req.on("error", function(error){ return done(error) })

  if (streaming){
    // without this the tar stream's own failure lands as an unhandled "error"
    // event and takes the process with it. axios attaches the equivalent.
    body.on("error", function(error){
      req.destroy()
      return done(error)
    })
    return body.pipe(req)
  }

  return req.end(body === undefined || body === null ? undefined : body)
}

module.exports      = request
module.exports.join = join

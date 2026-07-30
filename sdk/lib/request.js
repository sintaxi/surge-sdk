
// one transport for both runtimes. fetch is a global in browsers and in node
// 18.13+, so this file is byte-identical in the sdk and stream packages and
// needs no bundler shim, no "browser" field, and no dependencies.
//
//   request(opts, callback) -> callback(error, res, text, stream)
//   res: { statusCode, headers }
//
// opts.body may be a string or anything fetch accepts as a streaming body
// (a web ReadableStream, or any async iterable — tar's minipass qualifies).
// opts.stream:true skips reading the body and hands back res.body, the web
// stream, for the ndjson handshakes to consume.

var pkg = require("../package.json")

// fetch refuses a header value holding anything above U+00FF or a control
// character; node's http quietly dropped the former. publishing must not fail
// because someone put an emoji in their -m message, so strip rather than throw
// — the message is cosmetic, the publish is not. \t is legal in a value.
var headerSafe = function(value){
  return String(value).replace(/[^\t\x20-\x7e\xa0-\xff]/g, "")
}

var clean = function(headers){
  var out = {}
  Object.keys(headers || {}).forEach(function(key){
    var value = headers[key]
    if (value === undefined || value === null) return
    out[key] = headerSafe(value)
  })
  return out
}

// btoa is latin1 and throws above U+00FF, so encode to utf-8 first. that is
// what axios did, and what keeps a non-ascii password working.
var basic = function(auth){
  if (!auth) return null
  var raw   = (auth.username || "") + ":" + (auth.password || "")
  var bytes = new TextEncoder().encode(raw)
  var latin = ""
  for (var i = 0; i < bytes.length; i++) latin += String.fromCharCode(bytes[i])
  return "Basic " + btoa(latin)
}

// axios baseURL semantics: one slash between the two, never zero and never
// two. note this is NOT url.resolve, which drops the last path segment of an
// endpoint that carries a path.
var join = function(endpoint, path){
  if (/^https?:\/\//i.test(path)) return path
  return String(endpoint).replace(/\/+$/, "") + "/" + String(path).replace(/^\/+/, "")
}

var plain = function(headers){
  var out = {}
  headers.forEach(function(value, key){ out[key.toLowerCase()] = value })
  return out
}

var request = function(opts, callback){
  var headers   = clean(opts.headers)
  var body      = opts.body
  var sending   = body !== undefined && body !== null
  var streaming = sending && typeof body !== "string"

  if (sending && !streaming && !headers["content-type"]){
    headers["content-type"] = "application/json"
  }

  // honoured by node, silently dropped by browsers as a forbidden header
  if (!headers["user-agent"]) headers["user-agent"] = pkg.name + "/" + pkg.version

  // fetch sets content-length itself and forbids setting it by hand
  delete headers["content-length"]

  var authorization = basic(opts.auth)
  if (authorization) headers["authorization"] = authorization

  var init = {
    method:  opts.method || "GET",
    headers: headers
  }

  if (sending){
    init.body = body
    // node requires this whenever the body is not buffered up front
    if (streaming) init.duplex = "half"
  }

  fetch(opts.url, init).then(function(res){
    var adapted = { statusCode: res.status, headers: plain(res.headers) }
    if (opts.stream) return callback(null, adapted, null, res.body)
    return res.text().then(function(text){ return callback(null, adapted, text) })
  }).catch(function(error){
    // fetch reports every transport failure as a bare "fetch failed"; the
    // useful code (ECONNREFUSED, ENOTFOUND, CERT_*) hides in .cause
    if (error && error.cause && error.cause.code) error.code = error.cause.code
    return callback(error)
  })
}

module.exports      = request
module.exports.join = join

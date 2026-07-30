
// browser transport, selected by the "browser" field in package.json. the node
// build keeps lib/request.js (raw http/https) because that is what can tunnel
// through an HTTPS_PROXY; in a browser the proxy is the browser's problem and
// fetch is the only option, so the two builds split here rather than
// compromising either one. same contract as lib/request.js:
//
//   request(opts, callback) -> callback(error, res, text)
//   res: { statusCode, headers }

var clean = function(headers){
  var out = {}
  Object.keys(headers || {}).forEach(function(key){
    var value = headers[key]
    if (value === undefined || value === null) return
    out[key] = value
  })
  return out
}

// btoa is latin1 and throws above U+00FF, so encode to utf-8 first. this is
// what makes a non-ascii password produce the same Authorization header the
// node build sends.
var basic = function(auth){
  if (!auth) return null
  var raw   = (auth.username || "") + ":" + (auth.password || "")
  var bytes = new TextEncoder().encode(raw)
  var latin = ""
  for (var i = 0; i < bytes.length; i++) latin += String.fromCharCode(bytes[i])
  return "Basic " + btoa(latin)
}

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
  // the ndjson handshakes live in surge-stream, which is node-only anyway
  // (it tars a directory off disk), so nothing should ask for this here
  if (opts.stream) return callback(new Error("streaming requests are not supported in the browser"))

  var headers = clean(opts.headers)
  var body    = opts.body

  if (body !== undefined && body !== null && !headers["content-type"]){
    headers["content-type"] = "application/json"
  }

  // content-length and user-agent are forbidden header names in a browser —
  // the agent sets them and assigning them throws
  delete headers["content-length"]
  delete headers["user-agent"]

  var authorization = basic(opts.auth)
  if (authorization) headers["authorization"] = authorization

  fetch(opts.url, {
    method:  opts.method || "GET",
    headers: headers,
    body:    (body === undefined || body === null) ? undefined : body
  }).then(function(res){
    return res.text().then(function(text){
      return callback(null, { statusCode: res.status, headers: plain(res.headers) }, text)
    })
  }).catch(function(error){
    return callback(error)
  })
}

module.exports      = request
module.exports.join = join

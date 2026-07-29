
// shape-not-values summarizers. the golden journal records the structure of
// every request, callback and event rather than the values, because the suite
// mints a fresh timestamped account and random domains on every run. the few
// values that ARE contract (http status, event name, reason strings, the
// version header) are recorded verbatim.

// path segments that are route words rather than user data
var LITERALS = {}
;([
  "account", "stats", "list", "token", "tokens", "plan", "plans", "card",
  "subscription", "verification", "upgrade", "billing", "link", "reset",
  "status", "certs", "dns", "zone", "settings", "analytics", "usage", "audit",
  "cache", "rev", "rollback", "rollfore", "collaborators", "encrypt", "ssl",
  "cutover", "metadata.json", "manifest.json"
]).forEach(function(l){ LITERALS[l] = true })

// headers whose value is stable across runs and worth diffing
var VALUE_HEADERS = [
  "accept", "accept-encoding", "connection", "content-type", "reason",
  "transfer-encoding", "version"
]

// reason strings are contract and recorded verbatim, but the rate-limit one
// ends in a moment().to() rendering ("...try again in 15 minutes") that can
// tick over to 14 between runs. neutralize just the relative time so a false
// diff never costs anyone an afternoon.
var stabilize = exports.stabilize = function(text){
  return String(text).replace(/\b(in|for) (a|an|a few|\d+) (second|minute|hour|day)s?\b/gi, "$1 <time>")
}

var shapeOf = exports.shapeOf = function(v){
  if (v === null) return "null"
  if (v === undefined) return "undefined"
  if (Array.isArray(v)) return "array[" + v.length + "]"
  if (typeof v !== "object") return typeof v
  return "{" + Object.keys(v).sort().join(",") + "}"
}

// "Basic dG9rZW46" -> "Basic token:empty". the empty/set distinction catches
// the credential-coercion trap (a naive rewrite sends the string "undefined").
var authKind = function(value){
  if (!value) return "none"
  var parts = String(value).split(" ")
  if (parts[0] !== "Basic") return parts[0] || "unknown"
  var decoded
  try { decoded = Buffer.from(parts[1] || "", "base64").toString("utf8") }
  catch(e){ return "Basic undecodable" }
  var split = decoded.indexOf(":")
  var user = split === -1 ? decoded : decoded.slice(0, split)
  var pass = split === -1 ? null : decoded.slice(split + 1)
  var who = user === "token" ? "token" : (user.indexOf("@") !== -1 ? "<email>" : (user === "" ? "empty" : "<user>"))
  var secret = pass === null ? "absent" : (pass === "" ? "empty" : "set")
  return "Basic " + who + ":" + secret
}

exports.normalizePath = function(path){
  var query = ""
  var q = path.indexOf("?")
  if (q !== -1){ query = "?<query>"; path = path.slice(0, q) }

  var segs = path.split("/")
  return segs.map(function(s, i){
    if (s === "") return s
    if (LITERALS[s]) return s
    var prev = segs[i - 1]
    if (prev === "rev" || prev === "cutover") return "<rev>"
    if (prev === "dns" || prev === "zone" || prev === "tokens") return "<id>"
    if (prev === "reset") return segs[i - 2] === "token" ? "<email>" : "<token>"
    if (prev === "token" || prev === "upgrade" || prev === "billing") return "<token>"
    if (s.indexOf("@") !== -1) return "<email>"
    if (s.indexOf(".") !== -1) return "<domain>"
    return s
  }).join("/") + query
}

exports.summarizeHeaders = function(headers){
  return Object.keys(headers).sort().map(function(k){
    if (k === "authorization") return k + "=" + authKind(headers[k])
    if (VALUE_HEADERS.indexOf(k) !== -1) return k + "=" + stabilize(headers[k])
    return k
  })
}

// ndjson line types in order — this is what the publish/ssl handshake is made of
var ndjsonTypes = function(text){
  return text.split("\n").filter(function(l){ return l.trim() !== "" }).map(function(l){
    try { return JSON.parse(l).type || "<untyped>" } catch(e){ return "<unparsable>" }
  })
}

// the api answers publish/encrypt/ssl with text/event-stream (not the
// application/x-ndjson the client asks for), so sniff the body too — recording
// the line types keeps the record stable, where a byte count drifts with
// whatever domain name and timestamps the run happened to mint.
var looksNdjson = function(text){
  var lines = text.split("\n").filter(function(l){ return l.trim() !== "" })
  if (lines.length < 2) return false
  return lines.every(function(l){
    try { JSON.parse(l); return true } catch(e){ return false }
  })
}

exports.summarizeBody = function(buffer, contentType){
  if (!buffer || !buffer.length) return { bytes: 0 }

  var ct = String(contentType || "").split(";")[0].trim()
  if (ct === "application/gzip" || ct === "application/x-pem-file"){
    return { contentType: ct, bytes: buffer.length }
  }

  var text = buffer.toString("utf8")
  if (ct === "application/x-ndjson" || ct === "text/event-stream"){
    return { contentType: ct, ndjson: ndjsonTypes(text) }
  }

  try { return { json: shapeOf(JSON.parse(text)) } } catch(e){}
  if (looksNdjson(text)) return { contentType: ct || "unknown", ndjson: ndjsonTypes(text) }
  return { contentType: ct || "unknown", bytes: buffer.length }
}

// outcome is computed without truthiness on purpose: an empty-string error is
// currently FALSY, and recording it as "success" would hide the very bug the
// rewrite is meant to fix.
exports.summarizeCallback = function(error, data){
  var out = {}
  var present = !(error === null || error === undefined)
  out.outcome = present ? "error" : "success"

  if (present){
    out.errorType = typeof error
    out.errorShape = shapeOf(error)
    if (error && typeof error === "object"){
      out.status = error.status
      out.messages = shapeOf(error.messages)
      out.details = shapeOf(error.details)
    } else {
      out.errorValue = error === "" ? "\"\"" : typeof error + "(" + String(error).length + ")"
    }
  } else {
    out.dataShape = shapeOf(data)
    if (typeof data === "string") out.dataValue = data === "" ? "\"\"" : "string(" + data.length + ")"
  }
  return out
}

// string payloads are the reason-header contract ("Unauthorized", "Forbidden",
// "Rate limited. Try again later.") so their values are recorded verbatim.
exports.summarizeEvent = function(name, payload){
  var out = { event: name, payload: shapeOf(payload) }
  if (typeof payload === "string") out.value = stabilize(payload)
  return out
}

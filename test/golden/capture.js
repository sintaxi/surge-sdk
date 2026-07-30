
// golden capture harness — mocha root-hook plugin.
//
//   npm run golden          (records the current implementation)
//   npm run golden:verify   (records again and diffs against the baseline)
//
// two recorders feed one ordered journal:
//   1. a pass-through proxy on :5002 forwarding to slushi on :5001, taping the
//      real wire request/response of every call
//   2. wrappers around the sdk + stream module exports, taping every callback
//      invocation and every emitter event, in emit order
//
// both run in the mocha process so the journal is a single ordered log.

var fs    = require("fs")
var http  = require("http")
var path  = require("path")
var sum   = require("./summarize")

var PORT     = parseInt(process.env.GOLDEN_PORT || "5002", 10)
var UPSTREAM = parseInt(process.env.GOLDEN_UPSTREAM || "5001", 10)
var OUT      = process.env.GOLDEN_OUT || path.join(__dirname, "axios-baseline.json")
var MAX_TAP  = 65536

var journal = []
var seq = 0
var next = function(){ return seq++ }

var record = function(entry){
  entry.seq = next()
  journal.push(entry)
  return entry
}

// ---------------------------------------------------------------- the proxy

var tap = function(stream, onDone){
  var chunks = []
  var bytes = 0
  stream.on("data", function(c){
    bytes += c.length
    if (bytes <= MAX_TAP) chunks.push(c)
  })
  stream.on("end", function(){ onDone(Buffer.concat(chunks), bytes) })
}

// hop-by-hop headers belong to a single connection and must not be relayed
// (RFC 7230 6.1). copying the upstream transfer-encoding onto our own response
// re-frames a body node is already framing — the old http client tolerated it,
// undici does not, and a streamed publish stalls until the test times out.
var HOP_BY_HOP = [
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade"
]

var relayable = function(headers){
  var out = {}
  Object.keys(headers).forEach(function(key){
    if (HOP_BY_HOP.indexOf(key.toLowerCase()) !== -1) return
    out[key] = headers[key]
  })
  return out
}

var proxy = http.createServer(function(creq, cres){
  var entry = record({
    kind: "http",
    method: creq.method,
    path: sum.normalizePath(creq.url),
    headers: sum.summarizeHeaders(creq.headers)
  })

  tap(creq, function(buf, bytes){
    entry.request = sum.summarizeBody(buf, creq.headers["content-type"])
    if (bytes > MAX_TAP) entry.request.bytes = bytes
  })

  var preq = http.request({
    hostname: "127.0.0.1",
    port: UPSTREAM,
    path: creq.url,
    method: creq.method,
    // forwarded as-is: stripping connection here changes how slushi frames its
    // own response, which shows up as journal noise that is purely the proxy's
    headers: creq.headers,
    // fresh socket per request so a pooled connection can never carry state
    // between two recorded calls
    agent: false
  }, function(pres){
    entry.responseStatus = pres.statusCode
    entry.responseHeaders = sum.summarizeHeaders(pres.headers)
    tap(pres, function(buf){
      entry.response = sum.summarizeBody(buf, pres.headers["content-type"])
    })
    cres.writeHead(pres.statusCode, relayable(pres.headers))
    pres.pipe(cres)
  })

  preq.on("error", function(error){
    entry.transportError = error.code || error.message
    cres.writeHead(502, { "Content-Type": "application/json" })
    cres.end(JSON.stringify({ messages: ["golden proxy: " + (error.code || error.message)] }))
  })

  creq.pipe(preq)
})

// ------------------------------------------------------- module interception

// replacing module.exports in the require cache means the test files pick the
// wrapped factory up from their own plain require("../sdk") call.
var patch = function(id, wrap){
  var resolved = require.resolve(id)
  var original = require(resolved)
  require.cache[resolved].exports = wrap(original)
}

var wrapEmitter = function(entry, emitter){
  if (!emitter || typeof emitter.emit !== "function") return emitter
  var original = emitter.emit
  emitter.emit = function(name){
    // summarized synchronously and on purpose: handleResponseData emits "data"
    // with `type` still on the object, then deletes it before re-emitting. a
    // deferred read would see the mutated object and lose that invariant.
    entry.events.push(sum.summarizeEvent(name, arguments[1]))
    return original.apply(emitter, arguments)
  }
  return emitter
}

var wrapMethod = function(api, name){
  var fn = api[name]
  return function(){
    var args = Array.prototype.slice.call(arguments)
    var last = args[args.length - 1]

    if (typeof last === "function"){
      var entry = record({ kind: "call", method: name })
      args[args.length - 1] = function(error, data){
        entry.callback = sum.summarizeCallback(error, data)
        return last.apply(this, arguments)
      }
      return fn.apply(api, args)
    }

    // publish / encrypt / ssl return an emitter instead of taking a callback
    var streamEntry = record({ kind: "stream", method: name, events: [] })
    return wrapEmitter(streamEntry, fn.apply(api, args))
  }
}

patch("../../sdk", function(sdk){
  return function(config, surgeStream){
    var api = sdk(config, surgeStream)

    // only record clients aimed at the recording proxy. the transport unit
    // tests point sdk instances at throwaway localhost servers, and letting
    // those into the journal would make the baseline depend on which unit
    // tests happen to exist rather than on the api contract.
    if (!config || String(config.endpoint).indexOf(":" + PORT) === -1) return api

    var wrapped = {}
    Object.keys(api).forEach(function(name){
      wrapped[name] = typeof api[name] === "function" ? wrapMethod(api, name) : api[name]
    })
    return wrapped
  }
})

// ------------------------------------------------------------------ lifecycle

var written = false
var write = function(){
  if (written) return
  written = true
  fs.writeFileSync(OUT, JSON.stringify({
    recorded: journal.length,
    journal: journal
  }, null, 2) + "\n")
  console.log("\n  golden: wrote " + journal.length + " records to " + OUT)
}

// --exit means the afterAll hook is not guaranteed to be the last thing to run
process.on("exit", write)

exports.mochaHooks = {
  beforeAll: function(done){
    proxy.listen(PORT, function(){
      console.log("  golden: proxy :" + PORT + " -> slushi :" + UPSTREAM)
      done()
    })
    proxy.on("error", done)
  },
  afterAll: function(done){
    write()
    // keep-alive sockets would hold close() open past the hook timeout
    proxy.closeAllConnections()
    proxy.close(function(){ done() })
  }
}

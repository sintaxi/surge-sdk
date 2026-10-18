
var path          = require("path")
var fs            = require("fs")
var url           = require("url")
var EventEmitter  = require('events')
var zlib          = require("zlib")
var Readable      = require("stream").Readable
var Transform     = require("stream").Transform
var pipeline      = require("stream").pipeline
var split         = require("split")
var pack          = require("./pack")
var Ignore        = require('ignore')
var surgeIgnore   = require("surge-ignore")
var request       = require("./request")


var stream = function(config){

  var creds = function(args){
    if(!args) return null

    if (typeof args === 'string'){
      return {
        username: "token",
        password: args
      }
    }
    return {
      username: args.username || args.user,
      password: args.password || args.pass
    }
  }

  // Helper: Recursively get all files in a directory
  //
  // symlinks are resolved here, client side, and packed as the content they
  // point at (tar follow), so the server only ever receives regular files. a
  // link that resolves to nothing (dangling, or back to an ancestor) is
  // skipped and reported rather than crashing the publish. entries that are
  // not symlinks take exactly the path they always have.
  //
  // ancestors holds the real path of every directory above this one, root
  // first, so a link back up the tree is caught before it recurses
  var getFiles = function(dir, ig, prefix, ancestors, skipped) {
    var results = []
    var entries = fs.readdirSync(dir)
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i]
      var fullPath = path.join(dir, entry)
      var relativePath = prefix ? prefix + "/" + entry : entry
      var stat = fs.lstatSync(fullPath)
      var isLink = stat.isSymbolicLink()
      if (isLink) {
        try {
          stat = fs.statSync(fullPath)
        } catch (e) {
          // dangling, or a chain of links that never ends (ELOOP)
          if (!ig.ignores(relativePath)) skipped.push(relativePath)
          continue
        }
      }
      if (stat.isDirectory()) {
        // Check if directory itself should be ignored
        if (ig.ignores(relativePath + "/")) continue
        var realPath = isLink
          ? fs.realpathSync.native(fullPath)
          : path.join(ancestors[ancestors.length - 1], entry)
        if (ancestors.indexOf(realPath) !== -1) {
          skipped.push(relativePath)
          continue
        }
        results = results.concat(getFiles(fullPath, ig, relativePath, ancestors.concat(realPath), skipped))
      } else if (stat.isFile()) {
        // Check if file should be ignored
        if (!ig.ignores(relativePath)) results.push(relativePath)
      } else if (!ig.ignores(relativePath)) {
        // fifos, sockets and devices have no content, and a fifo hangs tar
        skipped.push(relativePath)
      }
    }
    return results
  }

  // the archive, one file at a time: each file's header, its content read
  // as the upload drains (a project can be hundreds of MB), its padding,
  // then the end blocks. fs.stat follows a symlinked file to its target,
  // as getFiles already follows symlinked directories. Each file is read
  // for exactly the size its header states, as node-tar did: a file that
  // grows mid-publish (an agent rewriting the project) goes as it was at
  // the stat, one that shrinks fails the upload rather than corrupt it
  var tarStream = function(absolutePath, dirName, files){
    // look-ahead: the next AHEAD files are stat'd (and read, when small)
    // while the current one goes out, so a project of thousands of small
    // files isn't one round trip per file. Bounded: at most AHEAD small
    // files (each <= SMALL bytes) sit in memory at once
    var AHEAD = 8
    var SMALL = 1024 * 1024
    var CHUNK = 1024 * 1024

    var slots   = []      // index -> { err, stat, data, ready, waiting }
    var started = 0       // next index to prefetch
    var current = 0       // next index to emit
    var reading = null    // a large file's read stream, while it goes out
    var busy    = false   // waiting on the current file's slot
    var done    = false

    var out = new Readable({
      highWaterMark: CHUNK,
      read: function(){
        if (reading) return reading.resume()
        if (!busy && !done) next()
      }
    })

    // a small file's content, exactly stat.size bytes: a file that grew
    // since the stat goes as it was, one that shrank can't be framed
    var readSmall = function(full, f, size, cb){
      fs.readFile(full, function(err, data){
        if (err) return cb(err)
        if (data.length < size) return cb(new Error("file shrank during publish: " + f))
        cb(null, data.length > size ? data.subarray(0, size) : data)
      })
    }

    var prefetch = function(){
      while (started < files.length && started - current < AHEAD){
        (function(i){
          var f = files[i], full = path.join(absolutePath, f)
          var slot = slots[i] = { ready: false, waiting: null }
          var finish = function(err, stat, data){
            slot.err = err; slot.stat = stat; slot.data = data; slot.ready = true
            if (slot.waiting){ var w = slot.waiting; slot.waiting = null; w() }
          }
          fs.stat(full, function(err, stat){
            if (err) return finish(err)
            if (stat.size === 0 || stat.size > SMALL) return finish(null, stat, null)
            readSmall(full, f, stat.size, function(err, data){ finish(err, stat, data) })
          })
        })(started++)
      }
    }

    var next = function(){
      if (current >= files.length){
        done = true
        out.push(Buffer.from(pack.end()))
        return out.push(null)
      }
      prefetch()
      var i = current, slot = slots[i]
      if (!slot.ready){
        busy = true
        slot.waiting = function(){ busy = false; emit(i) }
        return
      }
      emit(i)
    }

    var emit = function(i){
      var slot = slots[i], f = files[i]
      slots[i] = null
      current = i + 1
      if (slot.err) return out.destroy(slot.err)
      var size = slot.stat.size
      out.push(Buffer.from(pack.header(dirName + "/" + f, size, slot.stat.mode)))
      if (size === 0) return next()
      if (slot.data){
        out.push(slot.data)
        if (out.push(Buffer.from(pack.padding(size)))) next()
        return
      }
      // a large file streams, read for exactly its stated size
      var sent = 0
      reading = fs.createReadStream(path.join(absolutePath, f), { start: 0, end: size - 1, highWaterMark: CHUNK })
      reading.on("data", function(chunk){
        sent += chunk.length
        if (!out.push(chunk)) reading.pause()
      })
      reading.on("error", function(err){ out.destroy(err) })
      reading.on("end", function(){
        reading = null
        if (sent !== size) return out.destroy(new Error("file shrank during publish: " + f))
        if (out.push(Buffer.from(pack.padding(size)))) next()
      })
    }

    return out
  }

  // gzip as node-tar's portable mode wrote it: the OS byte of the gzip
  // header (byte 9) is 255, "unknown", not the packing machine's OS
  var portableGzip = function(){
    var first = true
    return new Transform({
      transform: function(chunk, enc, cb){
        if (first && chunk.length > 9){
          first = false
          chunk[9] = 255
        }
        cb(null, chunk)
      }
    })
  }

  // Helper: Create project read stream with tar + gzip
  var createProjectStream = function(projectPath){
    // Create ignore filter with default surge rules
    var ig = Ignore().add(surgeIgnore)

    // Load .surgeignore if it exists
    var surgeignorePath = path.join(projectPath, ".surgeignore")
    if (fs.existsSync(surgeignorePath)) {
      ig.add(fs.readFileSync(surgeignorePath, "utf8"))
    }

    // the directory's name prefixes every entry: "dirname/file.txt", not
    // "./file.txt"
    var absolutePath = path.resolve(projectPath)
    var dirName = path.basename(absolutePath)

    // Get all files (not directories) to pack, respecting ignore rules
    var skipped = []
    var files = getFiles(absolutePath, ig, "", [fs.realpathSync.native(absolutePath)], skipped)

    // only file entries, no directory entries, each under the directory's
    // name ("dirname/file.txt"), which the server strips
    var body = pipeline(tarStream(absolutePath, dirName, files), zlib.createGzip(), portableGzip(), function(){})

    return { body: body, skipped: skipped }
  }

  // Helper: Handle NDJSON response data and emit events
  var handleResponseData = function(emitter, data, successRef){
    try {
      var obj = JSON.parse(data)
      emitter.emit("data", obj)

      if (obj.type === "info") successRef.value = true

      var t = obj.type
      delete obj.type

      emitter.emit(t, obj)
    } catch(e) {
      // Ignore JSON parse errors (empty lines, etc)
    }
  }

  // Helper: Handle HTTP error status codes
  var handleErrorStatus = function(emitter, statusCode, headers){
    if (statusCode == 401) emitter.emit("unauthorized", headers["reason"] || "Unauthorized")
    if (statusCode == 403) emitter.emit("forbidden", headers["reason"] || "Forbidden")
    if (statusCode == 422) emitter.emit("invalid", headers["reason"] || "Invalid")
    if (statusCode == 429) emitter.emit("ratelimited", headers["reason"] || "Rate limited. Try again later.")
  }

  // one handshake for all three verbs. they differ only in the path they PUT
  // to, what they send as a body, and the content-type; everything after the
  // response is identical, so it lives here once.
  var handshake = function(opts){
    var emitter = new EventEmitter()
    var success = { value: false }

    var headers = Object.assign({ version: config.version }, opts.headers || {})
    if (opts.argv) headers.argv = JSON.stringify(opts.argv)

    headers["accept"] = "application/x-ndjson"
    if (opts.contentType) headers["content-type"] = opts.contentType

    request({
      url:     url.resolve(config.endpoint, opts.path),
      method:  "PUT",
      headers: headers,
      body:    opts.body,
      auth:    creds(opts.userCreds),
      stream:  true
    }, function(error, res){
      // node can call back synchronously on a setup failure, and the caller
      // attaches its listeners only after this function returns — so every
      // emission has to wait a tick
      if (error) return process.nextTick(function(){ emitter.emit("fail") })

      // carries the real status and headers, which is what surge ssl reads to
      // report a 401/403 instead of exiting silently
      emitter.emit("response", res)

      if (res.statusCode < 200 || res.statusCode >= 300){
        // status-specific event first: a bare fail is what the cli treats as
        // an unexplained failure, so it must never arrive before the reason
        handleErrorStatus(emitter, res.statusCode, res.headers)
        emitter.emit("fail")
        res.resume()
        return
      }

      res.pipe(split()).on("data", function(data){
        handleResponseData(emitter, data, success)
      })

      res.on("error", function(error){
        emitter.emit("error", error)
      })

      res.on("end", function(){
        success.value === true
          ? emitter.emit("success")
          : emitter.emit("fail")
      })
    })

    return emitter
  }

  // ============================================================
  // PUBLIC API
  // ============================================================

  var publish = function(projectPath, projectDomain, userCreds, headers, argv){
    var project = createProjectStream(projectPath)
    var emitter = handshake({
      path:        projectDomain,
      body:        project.body,
      contentType: "application/gzip",
      userCreds:   userCreds,
      headers:     headers,
      argv:        argv
    })
    // the caller attaches its listeners only after this returns
    if (project.skipped.length){
      process.nextTick(function(){ emitter.emit("skipped", project.skipped) })
    }
    return emitter
  }

  var encrypt = function(projectDomain, userCreds, headers, argv){
    return handshake({
      path:      projectDomain + "/encrypt",
      userCreds: userCreds,
      headers:   headers,
      argv:      argv
    })
  }

  var ssl = function(pemPath, projectDomain, userCreds, headers, argv){
    return handshake({
      path:        projectDomain + "/ssl",
      body:        fs.createReadStream(pemPath),
      contentType: "application/x-pem-file",
      userCreds:   userCreds,
      headers:     headers,
      argv:        argv
    })
  }

  return {
    encrypt: encrypt,
    publish: publish,
    ssl: ssl
  }
}

module.exports = stream

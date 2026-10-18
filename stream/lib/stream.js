
var path          = require("path")
var fs            = require("fs")
var crypto        = require("crypto")
var url           = require("url")
var EventEmitter  = require('events')
var zlib          = require("zlib")
var Readable      = require("stream").Readable
var Transform     = require("stream").Transform
var pipeline      = require("stream").pipeline
var split         = require("split")
var pack          = require("./pack")
var project       = require("./project")
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
  // entries: [{ name, full }] - the path inside the project, and the file
  // on disk it's read from (a single file is published under another name)
  var tarStream = function(dirName, entries){
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
      while (started < entries.length && started - current < AHEAD){
        (function(i){
          var f = entries[i].name, full = entries[i].full
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
      if (current >= entries.length){
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
      var slot = slots[i], f = entries[i].name
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
      reading = fs.createReadStream(entries[i].full, { start: 0, end: size - 1, highWaterMark: CHUNK })
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

  // the files a page uses that exist next to it on disk: publishing the
  // page alone leaves them behind
  var localReferences = function(file){
    var html
    try { html = fs.readFileSync(file, "utf8").slice(0, 2 * 1024 * 1024) } catch(e){ return [] }
    var dir = path.dirname(file)
    return project.references(html).filter(function(ref){
      try { return fs.statSync(path.join(dir, ref)).isFile() } catch(e){ return false }
    }).slice(0, 20)
  }

  var singleFile = function(file){
    var name = path.basename(file)
    var rule = project.single(name)
    if (rule.refused) return { refused: rule.refused }
    return {
      entries: [{ name: rule.as, full: file }],
      dirName: name.replace(/\.[^.]*$/, "") || "project",
      skipped: [],
      single: { file: name, as: rule.as, local: localReferences(file) }
    }
  }

  // the upload: entries packed under dirName (which the server strips),
  // gzipped
  var packBody = function(dirName, entries){
    return pipeline(tarStream(dirName, entries), zlib.createGzip(), portableGzip(), function(){})
  }

  // what a project is made of: { entries, dirName, skipped } plus single
  // for a one-file project, or { refused }
  var createProject = function(projectPath){
    if (fs.statSync(projectPath).isFile()) return singleFile(path.resolve(projectPath))

    // surge's ignore rules, plus the project's .surgeignore
    var surgeignorePath = path.join(projectPath, ".surgeignore")
    var ig = project.ignorer(fs.existsSync(surgeignorePath) ? fs.readFileSync(surgeignorePath, "utf8") : null)

    // the directory's name prefixes every entry: "dirname/file.txt", not
    // "./file.txt"
    var absolutePath = path.resolve(projectPath)
    var dirName = path.basename(absolutePath)

    // Get all files (not directories) to pack, respecting ignore rules
    var skipped = []
    var files = getFiles(absolutePath, ig, "", [fs.realpathSync.native(absolutePath)], skipped)

    // only file entries, no directory entries, each under the directory's
    // name ("dirname/file.txt"), which the server strips
    var entries = files.map(function(f){ return { name: f, full: path.join(absolutePath, f) } })

    return { entries: entries, dirName: dirName, skipped: skipped }
  }

  // upload dedupe (slushi plans/upload-dedupe.md): before packing, the
  // server is told every file's sha256 and size (POST /:domain/carry) and
  // answers which of them its current revision of the domain lacks. Only
  // those go in the upload, with the ticket that carries the rest. Any
  // trouble on the way - a file that can't be read, an older server, an
  // error, no answer - just means the upload sends everything, as always
  var CARRY_MIN   = 1024 * 1024        // smaller projects: the extra round trip costs more than it saves
  var CARRY_FILES = 100000             // the server's limit
  var CARRY_BODY  = 9 * 1024 * 1024    // under the server's 10mb

  var hashFile = function(full, cb){
    var hash = crypto.createHash("sha256"), size = 0
    var s = fs.createReadStream(full)
    s.on("data", function(d){ size += d.length; hash.update(d) })
    s.on("error", cb)
    s.on("end", function(){ cb(null, { sha256: hash.digest("hex"), size: size }) })
  }

  // name -> { sha256, size } for every entry, four files at a time
  var hashAll = function(entries, cb){
    var out = {}, next = 0, active = 0, finished = 0, failed = false
    var start = function(){
      while (active < 4 && next < entries.length){
        (function(e){
          active++
          hashFile(e.full, function(err, h){
            active--
            if (failed) return
            if (err){ failed = true; return cb(err) }
            out[e.name] = h
            if (++finished === entries.length) return cb(null, out)
            start()
          })
        })(entries[next++])
      }
    }
    if (!entries.length) return cb(null, out)
    start()
  }

  // calls back with { ticket, missing: [names] }, or nothing for a full
  // upload
  var askCarry = function(projectDomain, userCreds, entries, cb){
    hashAll(entries, function(err, files){
      if (err) return cb()
      var body = JSON.stringify({ files: files })
      if (Buffer.byteLength(body) > CARRY_BODY) return cb()
      request({
        url:     url.resolve(config.endpoint, projectDomain + "/carry"),
        method:  "POST",
        headers: { version: config.version, accept: "application/json" },
        body:    body,
        auth:    creds(userCreds),
        timeout: 30000
      }, function(err, res, text){
        if (err || res.statusCode !== 200) return cb()
        var reply = null
        try { reply = JSON.parse(text) } catch(e){}
        if (!reply || !reply.ticket || !Array.isArray(reply.missing)) return cb()
        cb({ ticket: reply.ticket, missing: reply.missing })
      })
    })
  }

  // Helper: Handle NDJSON response data and emit events
  // stale: set (instead of emitting anything) on the frame a carried
  // publish ends with when the server no longer has a carried file - the
  // publish goes again in full
  var handleResponseData = function(emitter, data, successRef, stale){
    try {
      var obj = JSON.parse(data)
      if (stale && obj.type === "error" && obj.error && obj.error.carry === "stale"){
        stale.value = true
        return
      }
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
  // opts.emitter: the caller's emitter, to keep one across a retry.
  // opts.retry: called in place of fail when a carried publish went stale
  var handshake = function(opts){
    var emitter = opts.emitter || new EventEmitter()
    var success = { value: false }
    var stale   = opts.retry ? { value: false } : null

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
        handleResponseData(emitter, data, success, stale)
      })

      res.on("error", function(error){
        emitter.emit("error", error)
      })

      res.on("end", function(){
        if (stale && stale.value && !success.value) return opts.retry()
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

  // file-count and project-size from the project itself when the caller
  // doesn't pass them (the size cap reads both before the upload)
  var withSizes = function(headers, entries, bytes){
    var out = Object.assign({}, headers || {})
    if (out["file-count"] === undefined) out["file-count"] = String(entries.length)
    if (out["project-size"] === undefined) out["project-size"] = String(bytes)
    return out
  }

  var totalSize = function(entries){
    return entries.reduce(function(n, e){
      try { return n + fs.statSync(e.full).size } catch(x){ return n }
    }, 0)
  }

  // projectPath: a directory, or a single file (see project.single)
  var publish = function(projectPath, projectDomain, userCreds, headers, argv){
    var project = createProject(projectPath)

    // refused before any request, in the shape a server refusal arrives in
    if (project.refused){
      var refused = new EventEmitter()
      process.nextTick(function(){
        refused.emit("error", { error: { message: project.refused } })
        refused.emit("fail")
      })
      return refused
    }

    var bytes   = totalSize(project.entries)
    var emitter = new EventEmitter()

    // headers always describe the whole project, however much of it the
    // upload carries. A carried upload that goes stale is sent again in
    // full, once, on the same emitter
    var send = function(entries, ticket){
      handshake({
        emitter:     emitter,
        path:        projectDomain,
        body:        packBody(project.dirName, entries),
        contentType: "application/gzip",
        userCreds:   userCreds,
        headers:     Object.assign(withSizes(headers, project.entries, bytes), ticket ? { "carry-ticket": ticket } : {}),
        argv:        argv,
        retry:       ticket ? function(){ send(project.entries, null) } : null
      })
    }

    var carrying = !project.single && bytes >= CARRY_MIN && project.entries.length <= CARRY_FILES
    if (!carrying){
      send(project.entries, null)
    } else {
      askCarry(projectDomain, userCreds, project.entries, function(reply){
        if (!reply) return send(project.entries, null)
        var missing = {}
        reply.missing.forEach(function(name){ missing[name] = true })
        var entries = project.entries.filter(function(e){ return missing[e.name] })
        emitter.emit("carry", { carried: project.entries.length - entries.length, sent: entries.length })
        send(entries, reply.ticket)
      })
    }

    // the caller attaches its listeners only after this returns
    if (project.single){
      process.nextTick(function(){ emitter.emit("single", project.single) })
    }
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

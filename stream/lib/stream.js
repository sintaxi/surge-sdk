
var path          = require("path")
var fs            = require("fs")
var url           = require("url")
var EventEmitter  = require('events')
var split         = require("split")
var zlib          = require('zlib')
var tar           = require('tarr')
var fsReader      = require('surge-fstream-ignore')
var ignore        = require("surge-ignore")
var axios         = require("axios")

// Optional: request is deprecated, only loaded if useAxios=false
var request
try {
  request = require("request")
} catch (e) {
  request = null
}


var stream = function(config){

  // Toggle implementation: false = request (stable), true = axios (experimental)
  config.useAxios = true

  config.defaults = Object.assign({
    401: function(e, r, b){ console.log("Unauthorized"); },
    417: function(e, r, b){ console.log("Upgrade Required"); },
    426: function(e, r, b){ console.log("Upgrade Required"); },
    429: function(e, r, b){ console.log("Too Many Requests"); },
    404: new Function
  }, config.defaults || {})

  var handle = function(e, r, b){
    if (e) return config.defaults[r.statusCode](e)
    if (config.defaults.hasOwnProperty(r.statusCode)){
      return config.defaults[r.statusCode](e, r, b)
    }
  }

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

  var failResponse = { errors:  [ "request did not complete" ], details: {"request": "did not complete" }}

  var agent = axios.create({
    baseURL: config.endpoint
  })

  var call = function(args, callback){
    agent(args).then(function(response){
      return callback(null, response.data)
    }).catch(function(error){
      if (error.response){
        error.response.data.status = error.response.status
        return callback(error.response.data)
      }
      if (error.request) return callback({ errors: [ "request did not complete" ], details: {"request": "did not complete" }})
      return console.log('Error', error.message)
    })
  }

  // Helper: Create project read stream with tar + gzip
  var createProjectStream = function(projectPath){
    var project = fsReader({ 'path': projectPath, ignoreFiles: [".surgeignore"] })
    project.addIgnoreRules(ignore)
    return project.pipe(tar.Pack()).pipe(zlib.Gzip())
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
  }

  // ============================================================
  // REQUEST-BASED IMPLEMENTATIONS (original, stable)
  // ============================================================

  var _publishWithRequest = function(projectPath, projectDomain, userCreds, headers, argv){
    if (!request) {
      throw new Error('request library not installed. Run "npm install request" or set useAxios=true')
    }
    var success = { value: false }

    headers = Object.assign({ version: config.version }, headers || {})
    if (argv) headers.argv = JSON.stringify(argv)

    var emitter = new EventEmitter()

    var handshake = request.put(url.resolve(config.endpoint, projectDomain), { headers: headers })
    handshake.auth(userCreds.user, userCreds.pass, true)

    handshake.pipe(split()).on("data", function(data){
      handleResponseData(emitter, data, success)
    })

    handshake.on('error', function(error){
      emitter.emit("error", error)
    })

    handshake.on('end', function(){
      success.value === true
        ? emitter.emit("success")
        : emitter.emit("fail")
    })

    handshake.on("response", function(rsp){
      handleErrorStatus(emitter, rsp.statusCode, rsp.headers)
    })

    createProjectStream(projectPath).pipe(handshake)

    return emitter
  }

  var _encryptWithRequest = function(projectDomain, userCreds, headers, argv){
    if (!request) {
      throw new Error('request library not installed. Run "npm install request" or set useAxios=true')
    }
    var success = { value: false }

    headers = Object.assign({ version: config.version }, headers || {})
    if (argv) headers.argv = JSON.stringify(argv)

    var emitter = new EventEmitter()

    var handshake = request.put(url.resolve(config.endpoint, projectDomain + "/encrypt"), { headers: headers })
    handshake.auth(userCreds.user, userCreds.pass, true)

    handshake.pipe(split()).on("data", function(data){
      handleResponseData(emitter, data, success)
    })

    handshake.on('error', function(error){
      emitter.emit("error", error)
    })

    handshake.on('end', function(){
      success.value === true
        ? emitter.emit("success")
        : emitter.emit("fail")
    })

    handshake.on("response", function(rsp){
      handleErrorStatus(emitter, rsp.statusCode, rsp.headers)
    })

    return emitter
  }

  var _sslWithRequest = function(pemPath, projectDomain, userCreds, headers, argv){
    if (!request) {
      throw new Error('request library not installed. Run "npm install request" or set useAxios=true')
    }
    var success = { value: false }

    headers = Object.assign({ version: config.version }, headers || {})
    if (argv) headers.argv = JSON.stringify(argv)

    var emitter = new EventEmitter()

    var handshake = request.put(url.resolve(config.endpoint, projectDomain + "/ssl"), { headers: headers })
    handshake.auth(userCreds.user, userCreds.pass, true)

    handshake.pipe(split()).on("data", function(data){
      handleResponseData(emitter, data, success)
    })

    handshake.on('error', function(error){
      emitter.emit("error", error)
    })

    handshake.on('end', function(){
      success.value === true
        ? emitter.emit("success")
        : emitter.emit("fail")
    })

    handshake.on("response", function(rsp){
      handleErrorStatus(emitter, rsp.statusCode, rsp.headers)
    })

    fs.createReadStream(pemPath).pipe(handshake)

    return emitter
  }

  // ============================================================
  // AXIOS-BASED IMPLEMENTATIONS (new, experimental)
  // ============================================================

  var _publishWithAxios = function(projectPath, projectDomain, userCreds, headers, argv){
    var success = { value: false }

    headers = Object.assign({ version: config.version }, headers || {})
    if (argv) headers.argv = JSON.stringify(argv)

    var emitter = new EventEmitter()

    var projectStream = createProjectStream(projectPath)

    // Set headers for streaming upload
    headers["content-type"] = "application/gzip"
    headers["accept"] = "application/x-ndjson"
    headers["transfer-encoding"] = "chunked"

    var credentials = creds(userCreds)

    axios({
      method: "PUT",
      url: url.resolve(config.endpoint, projectDomain),
      responseType: "stream",
      headers: headers,
      data: projectStream,
      auth: credentials,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      httpAgent: false,
      httpsAgent: false
    }).then(function(response){
      var responseStream = response.data

      responseStream.pipe(split()).on("data", function(data){
        handleResponseData(emitter, data, success)
      })

      responseStream.on('error', function(error){
        emitter.emit("error", error)
      })

      responseStream.on('end', function(){
        success.value === true
          ? emitter.emit("success")
          : emitter.emit("fail")
      })
    }).catch(function(error){
      // Handle axios errors
      if (error.response) {
        // Server responded with error status - emit status-specific event only
        // (matches request-based implementation behavior)
        handleErrorStatus(emitter, error.response.status, error.response.headers)
        emitter.emit("fail")
      } else if (error.request) {
        // Request made but no response received - this is a real error
        emitter.emit("fail")
      } else {
        // Error setting up request - this is a real error
        emitter.emit("fail")
      }
    })

    return emitter
  }

  var _encryptWithAxios = function(projectDomain, userCreds, headers, argv){
    var success = { value: false }

    headers = Object.assign({ version: config.version }, headers || {})
    if (argv) headers.argv = JSON.stringify(argv)

    var emitter = new EventEmitter()

    headers["accept"] = "application/x-ndjson"

    var credentials = creds(userCreds)

    axios({
      method: "PUT",
      url: url.resolve(config.endpoint, projectDomain + "/encrypt"),
      responseType: "stream",
      headers: headers,
      auth: credentials,
      httpAgent: false,
      httpsAgent: false
    }).then(function(response){
      var responseStream = response.data

      responseStream.pipe(split()).on("data", function(data){
        handleResponseData(emitter, data, success)
      })

      responseStream.on('error', function(error){
        emitter.emit("error", error)
      })

      responseStream.on('end', function(){
        success.value === true
          ? emitter.emit("success")
          : emitter.emit("fail")
      })
    }).catch(function(error){
      if (error.response) {
        // Server responded with error status - emit status-specific event only
        handleErrorStatus(emitter, error.response.status, error.response.headers)
        emitter.emit("fail")
      } else if (error.request) {
        // Request made but no response received
        emitter.emit("fail")
      } else {
        // Error setting up request
        emitter.emit("fail")
      }
    })

    return emitter
  }

  var _sslWithAxios = function(pemPath, projectDomain, userCreds, headers, argv){
    var success = { value: false }

    headers = Object.assign({ version: config.version }, headers || {})
    if (argv) headers.argv = JSON.stringify(argv)

    var emitter = new EventEmitter()

    var pemStream = fs.createReadStream(pemPath)

    headers["content-type"] = "application/x-pem-file"
    headers["accept"] = "application/x-ndjson"

    var credentials = creds(userCreds)

    axios({
      method: "PUT",
      url: url.resolve(config.endpoint, projectDomain + "/ssl"),
      responseType: "stream",
      headers: headers,
      data: pemStream,
      auth: credentials,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      httpAgent: false,
      httpsAgent: false
    }).then(function(response){
      var responseStream = response.data

      responseStream.pipe(split()).on("data", function(data){
        handleResponseData(emitter, data, success)
      })

      responseStream.on('error', function(error){
        emitter.emit("error", error)
      })

      responseStream.on('end', function(){
        success.value === true
          ? emitter.emit("success")
          : emitter.emit("fail")
      })
    }).catch(function(error){
      if (error.response) {
        handleErrorStatus(emitter, error.response.status, error.response.headers)
        emitter.emit("fail")
      } else if (error.request) {
        emitter.emit("fail")
      } else {
        emitter.emit("fail")
      }
    })

    return emitter
  }

  // ============================================================
  // PUBLIC API
  // ============================================================

  return {

    // Expose implementation choice for testing/debugging
    _useAxios: config.useAxios,

    encrypt: function(projectDomain, userCreds, headers, argv){
      if (config.useAxios) {
        return _encryptWithAxios(projectDomain, userCreds, headers, argv)
      }
      return _encryptWithRequest(projectDomain, userCreds, headers, argv)
    },

    publish: function(projectPath, projectDomain, userCreds, headers, argv){
      if (config.useAxios) {
        return _publishWithAxios(projectPath, projectDomain, userCreds, headers, argv)
      }
      return _publishWithRequest(projectPath, projectDomain, userCreds, headers, argv)
    },

    ssl: function(pemPath, projectDomain, userCreds, headers, argv){
      if (config.useAxios) {
        return _sslWithAxios(pemPath, projectDomain, userCreds, headers, argv)
      }
      return _sslWithRequest(pemPath, projectDomain, userCreds, headers, argv)
    },

    // Direct access to specific implementations for testing
    publishWithRequest: _publishWithRequest,
    publishWithAxios: _publishWithAxios,
    encryptWithRequest: _encryptWithRequest,
    encryptWithAxios: _encryptWithAxios,
    sslWithRequest: _sslWithRequest,
    sslWithAxios: _sslWithAxios

  }
}

module.exports = stream

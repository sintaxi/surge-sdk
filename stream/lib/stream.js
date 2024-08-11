
var path          = require("path")
var fs            = require("fs")
var url           = require("url")
var EventEmitter  = require('events')
var split         = require("split")
var zlib          = require('zlib')
var tar           = require('tarr')
var fsReader      = require('surge-fstream-ignore')
var ignore        = require("surge-ignore")
var request       = require("request")
var axios         = require("axios")


var stream = function(config){

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
    //headers: {'version': config.version }
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

  return {

    encrypt: function(projectDomain, userCreds, headers, argv){
      var success = false

      headers = Object.assign({ version: config.version }, headers || {})

      if (argv) headers.argv = JSON.stringify(argv)
      
      var emitter   = new EventEmitter()
      
      var handshake = request.put(url.resolve(config.endpoint, projectDomain + "/encrypt"), { headers: headers })
      handshake.auth(userCreds.user, userCreds.pass, true)
      
      handshake.pipe(split()).on("data", function(data){
        try{
          var obj = JSON.parse(data)
          emitter.emit("data", obj)
          
          if (obj.type === "info") success = true

          var t = obj.type; 
          delete obj.type

          emitter.emit(t, obj)
        }catch(e){
          //console.log(e)
        }
      })

      handshake.on('error', function(error){
        emitter.emit("error", error)
      })

      handshake.on('end', function(){
        success === true
          ? emitter.emit("success")
          : emitter.emit("fail")
      })

      handshake.on("response", function(rsp){
        // emitter.emit("response", rsp)
        if (rsp.statusCode == 401) emitter.emit("unauthorized", rsp.headers["reason"] || "Unauthorized")
        if (rsp.statusCode == 403) emitter.emit("forbidden", rsp.headers["reason"] || "Forbidden")
        if (rsp.statusCode == 422) emitter.emit("invalid", rsp.headers["reason"] || "Invalid")
      })
    
      // var project = fsReader({ 'path': projectPath, ignoreFiles: [".surgeignore"] })
      // project.addIgnoreRules(ignore)
      // project.pipe(tar.Pack()).pipe(zlib.Gzip()).pipe(handshake)

      //project.pipe(handshake)

      //handshake.pipe()

      return emitter
    },

    publishWIP: function(projectPath, projectDomain, userCreds, headers, argv){
      var success = false

      headers = Object.assign({ version: config.version }, headers || {})
      if (argv) headers.argv = JSON.stringify(argv)
      var emitter = new EventEmitter()

      var project = fsReader({ 'path': projectPath, ignoreFiles: [".surgeignore"] })
      project.addIgnoreRules(ignore)

      var readStream = project.pipe(tar.Pack()).pipe(zlib.Gzip())


      headers["content-type"] = ""
      headers["accept"] = "application/ndjson"

      axios({ 
        method: "PUT",
        url: url.resolve(config.endpoint, projectDomain),
        responseType: "stream",
        headers: headers,
        data: readStream,
        auth: {
          username: userCreds.user,
          password: userCreds.pass
        }
      }).then(handshake => {
        handshake.pipe(split()).on("data", function(data){
          try{
            var obj = JSON.parse(data)
            emitter.emit("data", obj)
            
            if (obj.type === "info") success = true

            var t = obj.type; 
            delete obj.type

            emitter.emit(t, obj)
          }catch(e){
            //console.log(e)
          }
        })

        handshake.on('error', function(error){
          emitter.emit("error", error)
        })

        handshake.on('end', function(){
          success === true
            ? emitter.emit("success")
            : emitter.emit("fail")
        })
      }).catch(error => {
        if (error.response.status == 401) emitter.emit("unauthorized", error.response.headers["reason"] || "Unauthorized")
        if (error.response.status == 403) emitter.emit("forbidden", error.response.headers["reason"] || "Forbidden")
        if (error.response.status == 422) emitter.emit("invalid", error.response.headers["reason"] || "Invalid")
      })

      return emitter
    },

    publish: function(projectPath, projectDomain, userCreds, headers, argv){
      var success = false

      headers = Object.assign({ version: config.version }, headers || {})

      if (argv) headers.argv = JSON.stringify(argv)
      
      var emitter   = new EventEmitter()
      
      var handshake = request.put(url.resolve(config.endpoint, projectDomain), { headers: headers })
      handshake.auth(userCreds.user, userCreds.pass, true)
      
      handshake.pipe(split()).on("data", function(data){
        try{
          var obj = JSON.parse(data)
          emitter.emit("data", obj)
          
          if (obj.type === "info") success = true

          var t = obj.type; 
          delete obj.type

          emitter.emit(t, obj)
        }catch(e){
          //console.log(e)
        }
      })

      handshake.on('error', function(error){
        emitter.emit("error", error)
      })

      handshake.on('end', function(){
        success === true
          ? emitter.emit("success")
          : emitter.emit("fail")
      })

      handshake.on("response", function(rsp){
        // console.log("have response", rsp)
        // emitter.emit("response", rsp)
        if (rsp.statusCode == 401) emitter.emit("unauthorized", rsp.headers["reason"] || "Unauthorized")
        if (rsp.statusCode == 403) emitter.emit("forbidden", rsp.headers["reason"] || "Forbidden")
        if (rsp.statusCode == 422) emitter.emit("invalid", rsp.headers["reason"] || "Invalid")
      })
    
      var project = fsReader({ 'path': projectPath, ignoreFiles: [".surgeignore"] })
      project.addIgnoreRules(ignore)
      project.pipe(tar.Pack()).pipe(zlib.Gzip()).pipe(handshake)

      return emitter
    }

  }
}

module.exports = stream
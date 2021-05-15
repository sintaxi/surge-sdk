
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


var sdk = function(config){

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

    stats: function(callback){
      return call({
        url: "/stats",
        method: "GET"
      }, callback)
    },

    account: function(userCreds, callback){
      return call({
        url: "/account",
        method: "GET",
        auth: creds(userCreds)
      }, callback)
    },

    nuke: function(userCreds, callback){
      return call({
        url: "/account",
        method: "DELETE",
        auth: creds(userCreds)
      }, callback)
    },
    
    token: function(userCreds, callback){
      agent({
        url: "/token",
        method: "POST",
        auth: creds(userCreds)
      }).then(function(response){
        return callback(null, { user: "token", pass: response.data.token })
      }).catch(function(error){
        if (error.response){
          error.response.data.status = error.response.status
          return callback(error.response.data)
        } 
        if (error.request) return callback(failResponse)
        return console.log('Error', error.message)
      })
    },

    certs: function(projectDomain, userCreds, callback){
      return call({
        url: "/" + projectDomain + "/certs",
        method: "GET",
        auth: creds(userCreds)
      }, callback)
    },

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
        // emitter.emit("response", rsp)
        if (rsp.statusCode == 401) emitter.emit("unauthorized", rsp.headers["reason"] || "Unauthorized")
        if (rsp.statusCode == 403) emitter.emit("forbidden", rsp.headers["reason"] || "Forbidden")
        if (rsp.statusCode == 422) emitter.emit("invalid", rsp.headers["reason"] || "Invalid")
      })
    
      var project = fsReader({ 'path': projectPath, ignoreFiles: [".surgeignore"] })
      project.addIgnoreRules(ignore)
      project.pipe(tar.Pack()).pipe(zlib.Gzip()).pipe(handshake)

      return emitter
    },

    metadata: function(projectDomain, projectRevision, userCreds, callback){
      if (!callback){
        callback = userCreds
        userCreds = projectRevision
        projectRevision = null
      }
      var u = projectRevision 
        ? "/" + projectDomain + "/" + projectRevision + "/metadata.json"
        : "/" + projectDomain + "/metadata.json"
      return call({
        url: u,
        method: "GET",
        auth: creds(userCreds)
      }, callback)
    },

    manifest: function(projectDomain, projectRevision, userCreds, callback){
      if (!callback){
        callback = userCreds
        userCreds = projectRevision
        projectRevision = null
      }
      var u = projectRevision 
        ? "/" + projectDomain + "/" + projectRevision + "/manifest.json"
        : "/" + projectDomain + "/manifest.json"
      return call({
        url: u,
        method: "GET",
        auth: creds(userCreds)
      }, callback)
    },

    list: function(projectDomain, userCreds, callback){
      if (!callback){
        callback = userCreds
        userCreds = projectDomain
        projectDomain = null
      }
      var u = projectDomain 
        ? "/" + projectDomain + "/list"
        : "/list"
      return call({
        url: u,
        method: "GET",
        auth: creds(userCreds)
      }, callback)
    }, 

    rollback: function(projectDomain, userCreds, callback){
      if (!projectDomain) return callback({
        messages: ["domain must be preset"],
        details: { domain: "must be present" }
      })
      return call({
        url: "/" + projectDomain + "/rollback",
        method: "POST",
        auth: creds(userCreds)
      }, callback)
    },

    rollfore: function(projectDomain, userCreds, callback){
      if (!projectDomain) return callback({
        messages: ["domain must be preset"],
        details: { domain: "must be present" }
      })
      return call({
        url: "/" + projectDomain + "/rollfore",
        method: "POST",
        auth: creds(userCreds)
      }, callback)
    },

    cutover: function(projectDomain, projectRevision, userCreds, callback){
      if (!callback){
        callback  = userCreds
        userCreds = projectRevision
        projectRevision = null
      }
      if (!projectDomain) return callback({
        messages: ["domain must be preset"],
        details: { domain: "must be present" }
      })
      var u = projectRevision
        ? "/" + projectDomain + "/rev/" + projectRevision.toString()
        : "/" + projectDomain + "/rev"
      return call({
        url: u,
        method: "PUT",
        auth: creds(userCreds)
      }, callback)
    },

    bust: function(projectDomain, userCreds, callback){
      if (!projectDomain) return callback({
        messages: ["domain must be preset"],
        details: { domain: "must be present" }
      })
      return call({
        url: "/" + projectDomain + "/cache",
        method: "DELETE",
        auth: creds(userCreds)
      }, callback)
    },

    teardown: function(projectDomain, userCreds, callback){
      if (!projectDomain) return callback({
        messages: ["domain must be preset"],
        details: { domain: "must be present" }
      })
      return call({
        url: "/" + projectDomain,
        method: "DELETE",
        auth: creds(userCreds)
      }, callback)
    },

    discard: function(projectDomain, projectRevision, userCreds, callback){
      if (!callback){
        callback = userCreds,
        userCreds = projectRevision,
        projectRevision = null
      }
      var u = projectRevision
        ? "/" + projectDomain + "/rev/" + projectRevision.toString()
        : "/" + projectDomain + "/rev"
      return call({
        url: u,
        method: "DELETE",
        auth: creds(userCreds)
      }, callback)
    },

    plan: function(args, userCreds, callback){
      return call({
        url: "/plan",
        method: "PUT",
        auth: creds(userCreds)
      }, callback)
    },

    card: function(args, userCreds, callback){
      // request({
      //   "uri": url.resolve(config.endpoint, "card"),
      //   "method": "PUT",
      //   "auth": userCreds,
      //   "form": args
      // }, function(e,r,b){
      //   handle(e,r,b)
      //   var obj = JSON.parse(b)
      //   if ([200,201].indexOf(r.statusCode) !== -1) {
      //     var obj = JSON.parse(b)
      //     return callback(null, obj)
      //   } else {
      //     return callback(obj)
      //   }
      // })

      return call({
        url: "/card",
        method: "PUT",
        auth: creds(userCreds),
        data: args
      }, callback)

      // agent({
      //   url: "/card",
      //   method: "PUT",
      //   auth: creds(userCreds)
      // }).then(function(response){
      //   return callback(null, response.data)
      // }).catch(function(error){
      //   if (error.response){
      //     error.response.data.status = error.response.status
      //     return callback(error.response.data)
      //   }
      //   if (error.request) return callback(failResponse)
      //   return console.log('Error', error.message)
      // })
    },

    plans: function(domain, headers, userCreds, callback){
      if (!callback){
        callback = userCreds
        userCreds = headers
        headers = domain
        domain = null
      }
      var u = domain
        ? "/" + domain + "/plans"
        : "/plans"
      return call({
        url: u,
        method: "GET",
        headers: headers,
        auth: creds(userCreds)
      }, callback)
    },

    invite: function(domain, args, userCreds, callback){
      if (!callback){
        callback = userCreds
        userCreds = args
        args = null
      }
      return call({
        url: "/" + domain + "/collaborators",
        method: "POST",
        data: args,
        auth: creds(userCreds)
      }, callback)
    },

    revoke: function(list, userCreds, callback){
      var emails  = list.filter(function(l){ return l.indexOf("@") !== -1 })
      var domains = list.filter(function(l){ return l.indexOf("@") === -1 })

      return call({
        url: "/" + domains[0] + "/collaborators",
        method: "DELETE",
        data: { emails: emails },
        auth: creds(userCreds)
      }, callback)

      // agent({
      //   url: "/" + domains[0] + "/collaborators",
      //   method: "DELETE",
      //   data: { emails: emails },
      //   auth: creds(userCreds)
      // }).then(function(response){
      //   return callback(null, response.data)
      // }).catch(function(error){
      //   if (error.response){
      //     error.response.data.status = error.response.status
      //     return callback(error.response.data)
      //   }
      //   if (error.request) return callback(failResponse)
      //   return console.log('Error', error.message)
      // })
    },

    dns: function(domain, userCreds, callback){
      return call({
        url: "/" + domain + "/dns",
        method: "GET",
        auth: creds(userCreds)
      }, callback)
    },

    zone: function(domain, userCreds, callback){
      return call({
        url: "/" + domain + "/zone",
        method: "GET",
        auth: creds(userCreds)
      }, callback)
    },

    dnsAdd: function(domain, args, userCreds, callback){
      return call({
        url: "/" + domain + "/dns",
        method: "POST",
        auth: creds(userCreds),
        data: args
      }, callback)
    },

    zoneAdd: function(domain, args, userCreds, callback){
      return call({
        url: "/" + domain + "/zone",
        method: "POST",
        auth: creds(userCreds),
        data: args
      }, callback)
    },

    dnsRem: function(domain, id, userCreds, callback){
      return call({
        url: "/" + domain + "/dns/" + id,
        method: "DELETE",
        auth: creds(userCreds)
      }, callback)
    },

    zoneRem: function(domain, id, userCreds, callback){
      return call({
        url: "/" + domain + "/zone/" + id,
        method: "DELETE",
        auth: creds(userCreds)
      }, callback)
    },

    settings: function(domain, args, userCreds, callback){
      return call({
        url: "/" + domain + "/settings",
        method: "PUT",
        auth: creds(userCreds),
        data: args
      }, callback)
    },

    analytics: function(domain, userCreds, callback){
      return call({
        url: "/" + domain + "/analytics",
        method: "GET",
        auth: creds(userCreds)
      }, callback)
    },

    usage: function(domain, userCreds, callback){
      return call({
        url: "/" + domain + "/usage",
        method: "GET",
        auth: creds(userCreds)
      }, callback)
    },

    audit: function(domain, userCreds, callback){
      return call({
        url: "/" + domain + "/audit",
        method: "GET",
        auth: creds(userCreds)
      }, callback)
    }

  }
}

sdk.testFiles = function(){
  return fs.readdirSync(__dirname + "/../test").filter(function(file) {
    return file.substr(-3) === '.js'
  }).map(function(file){
    return path.resolve( __dirname + "/../test/" + file)
  })
}

module.exports = sdk
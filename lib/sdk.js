
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

  var get = function(p){
    return function(domain, userCreds, callback){
      
      if (!domain) return callback({
        messages: ["domain must be preset"],
        details: { domain: "must be present" }
      })

      if (!callback){
        callback = userCreds
        userCreds = args
        args = null
      }
      request({
        "uri": url.resolve(config.endpoint, path.join(domain, p)),
        "method": "GET",
        "auth": userCreds
      }, function(e,r,b){
        handle(e,r,b)
        var obj = JSON.parse(b)
        if([200, 201, 202].indexOf(r.statusCode) !== -1){
          return callback(null, obj)
        } else {
          obj.status = r.statusCode
          return callback(obj)
        }
      })
    }
  }

  var del = function(p){
    return function(domain, id, userCreds, callback){
      if (!callback){
        callback = userCreds
        userCreds = args
        args = null
      }
      request({
        "uri": url.resolve(config.endpoint, path.join(domain, p, id.toString())),
        "method": "DELETE",
        "auth": userCreds
      }, function(e,r,b){
        handle(e,r,b)
        var obj = JSON.parse(b)
        obj.status = r.statusCode
        if([200, 201, 202].indexOf(r.statusCode) !== -1){
          return callback(null, obj)
        } else {
          return callback(obj)
        }
      })
    }
  }


  var put = function(p){
    return function(domain, args, userCreds, callback){
      if (!callback){
        callback = userCreds
        userCreds = args
        args = null
      }
      request({
        "uri": url.resolve(config.endpoint, path.join(domain, p)),
        "method": "PUT",
        "auth": userCreds,
        "form": args || {}
      }, function(e,r,b){
        handle(e,r,b)
        var obj = JSON.parse(b)
        if([200, 201, 202].indexOf(r.statusCode) !== -1){
          return callback(null, obj)
        } else {
          return callback(obj)
        }
      })
    }
  }


  var post = function(p){
    return function(domain, args, userCreds, callback){
      if (!callback){
        callback = userCreds
        userCreds = args
        args = null
      }
      request({
        "uri": url.resolve(config.endpoint, path.join(domain, p)),
        "method": "POST",
        "auth": userCreds,
        "form": args || {}
      }, function(e,r,b){
        handle(e,r,b)
        var obj = JSON.parse(b)
        obj.status = r.statusCode
        if([200, 201, 202].indexOf(r.statusCode) !== -1){
          return callback(null, obj)
        } else {
          return callback(obj)
        }
      })
    }
  }

  return {

    stats: function(callback){
      request({
        "url": config.endpoint + "/stats",
        "method": "GET",
        "headers": { version: config.version }
      }, function(e, r, b){
        handle(e,r,b)
        var obj = JSON.parse(b)
        return r.statusCode == 200
          ? callback(null, obj)
          : callback(obj)
      })
    },

    account: function(userCreds, callback){
      request({
        "url": config.endpoint + "/account",
        "method": "GET",
        "auth": userCreds,
        "headers": { version: config.version }
      }, function(e, r, b){
        handle(e,r,b)
        switch (r.statusCode) {
        case 200:
        case 201:
          return callback(null, JSON.parse(b)); break;
        default:
          var error = JSON.parse(b)
          error.status = r.statusCode
          return callback(error)
        }
      })
    },

    nuke: function(userCreds, callback){
      request({
        "url": config.endpoint + "/account",
        "method": "DELETE",
        "auth": userCreds,
        "headers": { version: config.version }
      }, function(e, r, b){
        handle(e,r,b)
        if (r.statusCode == 200){
          return callback(null, JSON.parse(b))
        }else{
          var error = JSON.parse(b)
          error.status = r.statusCode
          return callback(error)
        }
      })
    },
    
    token: function(userCreds, callback){
      request({
        "url": config.endpoint + "/token",
        "method": "POST",
        "auth": userCreds,
        "headers": { version: config.version }
      }, function(e, r, b){
        handle(e,r,b)
        if (r.statusCode == 201){
          var obj = JSON.parse(b)
          return callback(null, { user: "token", pass: obj.token })
        } else {
          return callback(obj)
        }
      })
    },

    certs: function(projectDomain, userCreds, callback){
      request({
        "url": url.resolve(config.endpoint, projectDomain + "/certs"),
        "method": "GET",
        "auth": userCreds,
        "headers": { version: config.version }
      }, function(e, r, b){
        handle(e,r,b)
        var obj = JSON.parse(b)
        if([200, 201, 202].indexOf(r.statusCode) !== -1){
          return callback(null, obj)
        } else {
          obj.status = r.statusCode
          return callback(obj)
        }
      })
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
        ? url.resolve(config.endpoint, path.join(projectDomain, projectRevision, "metadata.json")) 
        : url.resolve(config.endpoint, path.join(projectDomain, "metadata.json"))

      request({
        "url": u,
        "method": "GET",
        "auth": userCreds,
        "headers": { version: config.version }
      }, function(e, r, b){
        handle(e,r,b)
        var obj = JSON.parse(b)
        if (r.statusCode == 200){
          return callback(null, obj)
        } else {
          obj.status = r.statusCode
          return callback(obj)
        }
      })
    },

    manifest: function(projectDomain, projectRevision, userCreds, callback){
      if (!callback){
        callback = userCreds
        userCreds = projectRevision
        projectRevision = null
      }

      var u = projectRevision 
        ? url.resolve(config.endpoint, path.join(projectDomain, projectRevision, "manifest.json")) 
        : url.resolve(config.endpoint, path.join(projectDomain, "manifest.json"))

      request({
        "url": u,
        "method": "GET",
        "auth": userCreds,
        "headers": { version: config.version }
      }, function(e, r, b){
        handle(e,r,b)
        var obj = JSON.parse(b)
        if (r.statusCode == 200){
          return callback(null, obj)
        } else {
          obj.status = r.statusCode
          return callback(obj)
        }
      })
    },

    list: function(projectDomain, userCreds, callback){
      if (!callback){
        callback = userCreds
        userCreds = projectDomain
        projectDomain = null
      }

      var u = projectDomain 
        ? url.resolve(config.endpoint, path.join(projectDomain, "list"))
        : url.resolve(config.endpoint, "list")

      request({
        "url": u,
        "method": "GET",
        "auth": userCreds,
        "headers": { version: config.version }
      }, function(e, r, b){
        handle(e,r,b)
        var obj = JSON.parse(b)
        if (r.statusCode == 200){
          return callback(null, obj)
        } else {
          obj.status = r.statusCode
          return callback(obj)
        }
      })
    }, 

    rollback: function(projectDomain, userCreds, callback){

      if (!projectDomain) return callback({
        messages: ["domain must be preset"],
        details: { domain: "must be present" }
      })

      request({
        "url": url.resolve(config.endpoint, path.join(projectDomain, "rollback")),
        "method": "POST",
        "auth": userCreds,
        "headers": { version: config.version }
      }, function(e, r, b){
        handle(e,r,b)
        var obj = JSON.parse(b)
        obj.status = r.statusCode
        if([200,201,202].indexOf(r.statusCode) !== -1){
          return callback(null, obj)
        }else{
          return callback(obj)
        }
      })
    },

    rollfore: function(projectDomain, userCreds, callback){

      if (!projectDomain) return callback({
        messages: ["domain must be preset"],
        details: { domain: "must be present" }
      })

      request({
        "url": url.resolve(config.endpoint, path.join(projectDomain, "rollfore")),
        "method": "POST",
        "auth": userCreds,
        "headers": { version: config.version }
      }, function(e, r, b){
        handle(e,r,b)
        var obj = JSON.parse(b)
        obj.status = r.statusCode
        if([200,201,202].indexOf(r.statusCode) !== -1){
          return callback(null, obj)
        }else{
          return callback(obj)
        }
      })
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
        ? url.resolve(config.endpoint, path.join(projectDomain, "rev", projectRevision.toString()))
        : url.resolve(config.endpoint, path.join(projectDomain, "rev"))

      request({
        "url": u,
        "method": "PUT",
        "auth": userCreds,
        "headers": { version: config.version }
      }, function(e, r, b){
        handle(e,r,b)
        var obj = JSON.parse(b)
        obj.status = r.statusCode
        if([200,201,202].indexOf(r.statusCode) !== -1){
          return callback(null, obj)
        }else{
          return callback(obj)
        }
      })
    },

    bust: function(projectDomain, userCreds, callback){

      if (!projectDomain) return callback({
        messages: ["domain must be preset"],
        details: { domain: "must be present" }
      })

      request({
        "url": url.resolve(config.endpoint, path.join(projectDomain, "cache")),
        "method": "DELETE",
        "auth": userCreds,
        "headers": { version: config.version }
      }, function(e, r, b){
        handle(e,r,b)
        var obj = JSON.parse(b)
        obj.status = r.statusCode
        if([200,201,202].indexOf(r.statusCode) !== -1){
          return callback(null, obj)
        }else{
          return callback(obj)
        }
      })
    },

    teardown: function(projectDomain, userCreds, callback){

      if (!projectDomain) return callback({
        messages: ["domain must be preset"],
        details: { domain: "must be present" }
      })

      request({
        "url": url.resolve(config.endpoint, path.join(projectDomain)),
        "method": "DELETE",
        "auth": userCreds,
        "headers": { version: config.version }
      }, function(e, r, b){
        handle(e,r,b)
        if (r.statusCode == 200){
          return callback(null, JSON.parse(b))
        } else {
          var obj = JSON.parse(b)
          obj.status = r.statusCode
          return callback(obj)
        }
      })
    },

    discard: function(projectDomain, projectRevision, userCreds, callback){
      if (!callback){
        callback = userCreds,
        userCreds = projectRevision,
        projectRevision = null
      }

      var u = projectRevision
        ? url.resolve(config.endpoint, path.join(projectDomain, "rev", projectRevision.toString()))
        : url.resolve(config.endpoint, path.join(projectDomain, "rev"))

      request({
        "url": u,
        "method": "DELETE",
        "auth": userCreds,
        "headers": { version: config.version }
      }, function(e, r, b){
        handle(e,r,b)
        var obj = JSON.parse(b)
        obj.status = r.statusCode
        if([200,201,202].indexOf(r.statusCode) !== -1){
          return callback(null, obj)
        }else{
          return callback(obj)
        }
      })
    },

    plan: function(args, userCreds, callback){
      request({
        "uri": url.resolve(config.endpoint, "plan"),
        "method": "PUT",
        "auth": userCreds,
        "form": args
      }, function(e,r,b){
        handle(e,r,b)
        var obj = JSON.parse(b)
        obj.status = r.statusCode
        if([200,201].indexOf(r.statusCode) !== -1){
          return callback(null, obj)
        } else {
          return callback(obj)
        }
      })
    },

    card: function(args, userCreds, callback){
      request({
        "uri": url.resolve(config.endpoint, "card"),
        "method": "PUT",
        "auth": userCreds,
        "form": args
      }, function(e,r,b){
        handle(e,r,b)
        var obj = JSON.parse(b)
        if ([200,201].indexOf(r.statusCode) !== -1) {
          var obj = JSON.parse(b)
          return callback(null, obj)
        } else {
          return callback(obj)
        }
      })
    },

    plans: function(domain, headers, userCreds, callback){
      if (!callback){
        callback = userCreds
        userCreds = headers
        headers = domain
        domain = null
      }
      var plansUrl = domain
        ? url.resolve(config.endpoint, path.join(domain, "plans"))
        : url.resolve(config.endpoint, "plans")
      request({
        'url': plansUrl,
        'method': 'get',
        'headers': headers,
        'auth': userCreds
      }, function(e, r, obj){
        var obj = JSON.parse(obj)
        if (r.statusCode == 200){
          callback(null, obj)
        } else {
          callback(obj)
        }
      })
    },

    invite: function(domain, args, userCreds, callback){
      if (!callback){
        callback = userCreds
        userCreds = args
        args = null
      }
      request({
        "uri": url.resolve(config.endpoint, path.join(domain, "collaborators")),
        "method": "POST",
        "auth": userCreds,
        "form": args || {}
      }, function(e,r,b){
        handle(e,r,b)
        var obj = JSON.parse(b)
        obj.status = r.statusCode
        if([200, 201, 202].indexOf(r.statusCode) !== -1){
          return callback(null, obj)
        } else {
          return callback(obj)
        }
      })
    },

    revoke: function(list, userCreds, callback){
      var emails  = list.filter(function(l){ return l.indexOf("@") !== -1 })
      var domains = list.filter(function(l){ return l.indexOf("@") === -1 })

      request({
        "uri": url.resolve(config.endpoint, path.join(domains[0], "collaborators")),
        "method": "DELETE",
        "auth": userCreds,
        "form": { emails: emails }
      }, function(e,r,b){
        handle(e,r,b)
        var obj = JSON.parse(b)
        obj.status = r.statusCode
        if([200, 201, 202].indexOf(r.statusCode) !== -1){
          return callback(null, obj)
        } else {
          return callback(obj)
        }
      })
    },

    // encrypt: function(domain, args, userCreds, callback){
    //   if (!callback){
    //     callback = userCreds
    //     userCreds = args
    //     args = null
    //   }
    //   request({
    //     "uri": url.resolve(config.endpoint, path.join(domain, "encrypt")),
    //     "method": "POST",
    //     "auth": userCreds,
    //     "form": args || {}
    //   }, function(e,r,b){
    //     handle(e,r,b)
    //     var obj = JSON.parse(b)
    //     obj.status = r.statusCode
    //     if([200, 201, 202].indexOf(r.statusCode) !== -1){
    //       return callback(null, obj)
    //     } else {
    //       return callback(obj)
    //     }
    //   })
    // },


    dns: get("dns"),
    dnsAdd: post("dns"),
    dnsRem: del("dns"),
    zone: get("zone"),
    zoneAdd: post("zone"),
    zoneRem: del("zone"),
    settings: put("settings"),

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

var axios = require("axios")

var sdk = function(config, surgeStream){

  if (surgeStream){
    var stream = surgeStream(config)
  }

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

  var failResponse = { 
    errors:  [ "request did not complete" ], 
    details: {"request": "did not complete" }
  }

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
      if (error.request) return callback(failResponse)
      return console.log('Error', error.message)
    })
  }

  var placeholder = function(){
    console.log("`surge-stream` not found")
  }

  return {

    publish: stream ? stream.publish : placeholder,
    encrypt: stream ? stream.encrypt : placeholder,

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

module.exports = sdk
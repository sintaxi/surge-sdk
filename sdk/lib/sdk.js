
var request = require("./request")

var sdk = function(config, surgeStream){

  if (surgeStream){
    var stream = surgeStream(config)
  }

  // status handlers are supplied by the caller via config.defaults —
  // the sdk itself never writes to stdout. errors always reach the
  // callback regardless of whether a handler is registered.
  config.defaults = config.defaults || {}

  var handle = function(e, r, b){
    if (r && config.defaults.hasOwnProperty(r.status)){
      return config.defaults[r.status](e, r, b)
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

  // messages is what every consumer reads; errors is kept for compatibility
  var failResponse = {
    errors:   [ "request did not complete" ],
    messages: [ "request did not complete" ],
    details:  {"request": "did not complete" }
  }

  // parsed regardless of content-type and falling back to the raw text, which
  // is what axios did. an empty body is "". several routes reply with
  // pretty-printed json and a trailing newline — JSON.parse takes it.
  var parse = function(text){
    if (!text) return ""
    try { return JSON.parse(text) } catch(e){ return text }
  }

  // a non-2xx body that is not json — an html 404 from an unknown route, or a
  // body-less 5xx — used to reach the caller as a bare string. "" is falsy, so
  // an empty error body read as success and the failure vanished. callers all
  // expect messages/details/status, so describe the status instead.
  var describe = function(status){
    var msg = status >= 300 && status < 400
      ? "endpoint redirected (" + status + ")"
      : "request failed (" + status + ")"
    return {
      messages: [ msg ],
      details:  { request: msg },
      status:   status
    }
  }

  var call = function(args, callback){
    var body = (args.data === undefined || args.data === null)
      ? undefined
      : JSON.stringify(args.data)

    request({
      url:     request.join(config.endpoint, args.url),
      method:  args.method,
      headers: args.headers,
      body:    body,
      auth:    args.auth
    }, function(error, res, text){
      if (error) return callback(failResponse)

      var data = parse(text)

      // handle() keys off .status and must run before the callback: the cli
      // registers 403/404 handlers that process.exit(1), so for those the
      // callback is deliberately never reached
      var response = {
        status:     res.statusCode,
        statusCode: res.statusCode,
        headers:    res.headers,
        data:       data
      }

      handle(null, response, data)

      if (res.statusCode >= 200 && res.statusCode < 300) return callback(null, data)

      // 3xx lands here too — redirects are not followed
      if (data && typeof data === "object"){
        data.status = res.statusCode
        return callback(data)
      }

      return callback(describe(res.statusCode))
    })
  }

  var placeholder = function(){
    console.log("`surge-stream` not found")
  }

  return {

    publish: stream ? stream.publish : placeholder,
    encrypt: stream ? stream.encrypt : placeholder,
    ssl: stream ? stream.ssl : placeholder,

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
    
    token: function(userCreds, args, callback){
      if (!callback){
        callback = args
        args = null
      }
      return call({
        url: "/token",
        method: "POST",
        data: args || {},
        auth: creds(userCreds)
      }, function(error, data){
        if (error) return callback(error)
        return callback(null, { user: "token", pass: data.token })
      })
    },

    // full token response (token/id/msg/scope/created_at) —
    // token() above keeps the { user, pass } login shape
    tokenAdd: function(args, userCreds, callback){
      if (!callback){
        callback = userCreds
        userCreds = args
        args = null
      }
      return call({
        url: "/token",
        method: "POST",
        data: args || {},
        auth: creds(userCreds)
      }, callback)
    },

    tokens: function(userCreds, callback){
      return call({
        url: "/tokens",
        method: "GET",
        auth: creds(userCreds)
      }, callback)
    },

    tokenRem: function(id, userCreds, callback){
      if (!id) return callback({
        messages: ["token id must be present"],
        details: { token: "id must be present" }
      })
      return call({
        url: "/tokens/" + id,
        method: "DELETE",
        auth: creds(userCreds)
      }, callback)
    },

    reset: function(email, callback){
      return call({
        url: "/token/reset/" + email,
        method: "POST"
      }, callback)
    },

    // sends an email-verification link to the authenticated account.
    // replies: { verified: true } when already verified,
    // { sent: true } when the email went out, or { sent: false, msg }
    // when inside the resend window (one send per 5 minutes)
    verification: function(userCreds, callback){
      return call({
        url: "/verification",
        method: "POST",
        auth: creds(userCreds)
      }, callback)
    },

    // mints a 48h browser checkout link for the authed account.
    // plan is optional (defaults server-side); replies { url }
    upgradeLink: function(plan, userCreds, callback){
      if (!callback){
        callback = userCreds
        userCreds = plan
        plan = null
      }
      return call({
        url: "/upgrade/link",
        method: "POST",
        data: plan ? { plan: plan } : {},
        auth: creds(userCreds)
      }, callback)
    },

    // mints a 48h Stripe billing-portal link (card, invoices, cancel).
    // replies { url }
    billingLink: function(userCreds, callback){
      return call({
        url: "/billing/link",
        method: "POST",
        data: {},
        auth: creds(userCreds)
      }, callback)
    },

    // one status word and, when it is the user's move, one action —
    // { status, action, https, reason, records, evidence }
    status: function(projectDomain, userCreds, callback){
      if (!projectDomain) return callback({
        messages: ["domain must be preset"],
        details: { domain: "must be present" }
      })
      return call({
        url: "/" + projectDomain + "/status",
        method: "GET",
        auth: creds(userCreds)
      }, callback)
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

    plan: function(domain, args, userCreds, callback){
      if (!callback){
        callback  = userCreds
        userCreds = args
        args      = domain
        domain    = null
      }
      var u = domain
        ? "/" + domain + "/plan"
        : "/plan"
      return call({
        url: u,
        method: "PUT",
        auth: creds(userCreds),
        data: args
      }, callback)
    },

    // current subscription state. without a domain this is the account
    // (subscription: null when nothing is paid); with a domain it is the
    // project paywall payload (type/plan/perks/stripe_pk/card)
    subscription: function(domain, userCreds, callback){
      if (!callback){
        callback  = userCreds
        userCreds = domain
        domain    = null
      }
      var u = domain
        ? "/" + domain + "/subscription"
        : "/subscription"
      return call({
        url: u,
        method: "GET",
        auth: creds(userCreds)
      }, callback)
    },

    card: function(args, userCreds, callback){
      return call({
        url: "/card",
        method: "PUT",
        auth: creds(userCreds),
        data: args
      }, callback)
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
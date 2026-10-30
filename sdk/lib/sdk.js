
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

      if (res.statusCode >= 200 && res.statusCode < 300) return callback(null, data, res.headers)

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

    // browser-handoff login (plans/auth-cli-mfa.md stage 1): open a
    // device session, then poll for the approved token. No auth on
    // either call — this IS login. Poll answers are always 200 with a
    // status of pending, approved (token rides once), or gone.
    loginSession: function(host, callback){
      return call({
        url: "/login/session",
        method: "POST",
        data: { host: host }
      }, callback)
    },

    // opens a browser ceremony to set up or manage two-factor auth —
    // the page runs the whole ceremony, nothing comes back to collect
    mfaSession: function(userCreds, callback){
      return call({
        url: "/mfa/session",
        method: "POST",
        auth: creds(userCreds)
      }, callback)
    },

    loginPoll: function(uuid, poll, callback){
      return call({
        url: "/login/session/" + uuid + "/poll",
        method: "POST",
        data: { poll: poll }
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

    // one of the account's tokens becomes an org's, its value unchanged,
    // so a pipeline holding it keeps publishing - as the org from then on
    tokenTransfer: function(id, org, userCreds, callback){
      if (!id) return callback({
        messages: ["token id must be present"],
        details: { token: "id must be present" }
      })
      return call({
        url: "/tokens/" + id,
        method: "PUT",
        data: { org: org },
        auth: creds(userCreds)
      }, callback)
    },

    // an org's tokens (slushi plans/org-tokens.md): the org is the actor,
    // so they publish its domains whoever comes and goes. Any member lists,
    // adds and rems them
    orgTokens: function(org, userCreds, callback){
      return call({
        url: "/orgs/" + encodeURIComponent(org) + "/tokens",
        method: "GET",
        auth: creds(userCreds)
      }, callback)
    },

    // args: { msg, scope } - the value comes back here and never again
    orgTokenAdd: function(org, args, userCreds, callback){
      return call({
        url: "/orgs/" + encodeURIComponent(org) + "/tokens",
        method: "POST",
        data: args || {},
        auth: creds(userCreds)
      }, callback)
    },

    orgTokenRem: function(org, id, userCreds, callback){
      if (!id) return callback({
        messages: ["token id must be present"],
        details: { token: "id must be present" }
      })
      return call({
        url: "/orgs/" + encodeURIComponent(org) + "/tokens/" + encodeURIComponent(id),
        method: "DELETE",
        auth: creds(userCreds)
      }, callback)
    },

    // orgs (slushi plans/b2b.md): an org is named by its id or slug, or an
    // old slug that still resolves to it
    orgs: function(userCreds, callback){
      return call({
        url: "/orgs",
        method: "GET",
        auth: creds(userCreds)
      }, callback)
    },

    // the org and its members, with the caller's role
    org: function(org, userCreds, callback){
      return call({
        url: "/orgs/" + encodeURIComponent(org),
        method: "GET",
        auth: creds(userCreds)
      }, callback)
    },

    // args: { slug, name } - the caller becomes the org's only admin
    orgCreate: function(args, userCreds, callback){
      return call({
        url: "/orgs",
        method: "POST",
        data: args || {},
        auth: creds(userCreds)
      }, callback)
    },

    // args: { slug, name } - either or both
    orgRename: function(org, args, userCreds, callback){
      return call({
        url: "/orgs/" + encodeURIComponent(org),
        method: "PUT",
        data: args || {},
        auth: creds(userCreds)
      }, callback)
    },

    // refused while the org holds any domain; its slugs are free at once
    orgRemove: function(org, userCreds, callback){
      return call({
        url: "/orgs/" + encodeURIComponent(org),
        method: "DELETE",
        auth: creds(userCreds)
      }, callback)
    },

    // members and pending invites (pending: true)
    orgMembers: function(org, userCreds, callback){
      return call({
        url: "/orgs/" + encodeURIComponent(org) + "/members",
        method: "GET",
        auth: creds(userCreds)
      }, callback)
    },

    // one by email: a member's account email, the email its invite went
    // to, or a pending invite's
    orgMember: function(org, email, userCreds, callback){
      return call({
        url: "/orgs/" + encodeURIComponent(org) + "/members/" + encodeURIComponent(email),
        method: "GET",
        auth: creds(userCreds)
      }, callback)
    },

    // a one-time code any signed-in account can join with, for whoever
    // invites to deliver - nothing is emailed: { code, hint, role,
    // expires_at }. role is optional: "member" (the default) or "admin",
    // which only an admin may mint. claim joins with it, scrap cancels it
    orgInvite: function(org, role, userCreds, callback){
      if (!callback){
        callback = userCreds
        userCreds = role
        role = null
      }
      return call({
        url: "/orgs/" + encodeURIComponent(org) + "/invites",
        method: "POST",
        data: role ? { role: role } : {},
        auth: creds(userCreds)
      }, callback)
    },

    // role: "admin" | "member", for a member
    orgRole: function(org, email, role, userCreds, callback){
      return call({
        url: "/orgs/" + encodeURIComponent(org) + "/members/" + encodeURIComponent(email),
        method: "PUT",
        data: { role: role },
        auth: creds(userCreds)
      }, callback)
    },

    // removes a member
    orgRevoke: function(org, email, userCreds, callback){
      return call({
        url: "/orgs/" + encodeURIComponent(org) + "/members/" + encodeURIComponent(email),
        method: "DELETE",
        auth: creds(userCreds)
      }, callback)
    },

    // joins as the signed-in account, whatever email the invite went to
    orgJoin: function(org, code, userCreds, callback){
      return call({
        url: "/orgs/" + encodeURIComponent(org) + "/join",
        method: "POST",
        data: { code: code },
        auth: creds(userCreds)
      }, callback)
    },

    // who owns a domain: { owner: { account: email } | { org: { slug,
    // name } } | "someone else" }
    owner: function(projectDomain, userCreds, callback){
      return call({
        url: "/" + projectDomain + "/owner",
        method: "GET",
        auth: creds(userCreds)
      }, callback)
    },

    // moves a domain into an org you're in, or to your own account (to:
    // your email); anyone else gets a code instead (transferCode)
    transfer: function(projectDomain, to, userCreds, callback){
      return call({
        url: "/" + projectDomain + "/owner",
        method: "PUT",
        data: { to: to },
        auth: creds(userCreds)
      }, callback)
    },

    // a code whoever claims it takes the domain with: { code, expires_at }.
    // a new one each time; the last stops working
    transferCode: function(projectDomain, userCreds, callback){
      return call({
        url: "/" + projectDomain + "/owner/code",
        method: "POST",
        auth: creds(userCreds)
      }, callback)
    },

    // any code: a transfer code takes its domain into the signed-in
    // account ({ domain, owner, orgs }), an invite joins its org ({ org:
    // { slug, name }, role, already }). opts.check describes what the code
    // would do and does nothing: { check, kind: "transfer", domain, from,
    // by, expires_at, yours } or { check, kind: "invite", org, role, by,
    // expires_at, member }
    claim: function(code, opts, userCreds, callback){
      if (!callback){
        callback = userCreds
        userCreds = opts
        opts = {}
      }
      var data = { code: code }
      if (opts && opts.check) data.check = true
      return call({
        url: "/claim",
        method: "POST",
        data: data,
        auth: creds(userCreds)
      }, callback)
    },

    // cancels a code: { scrapped: "transfer", domain } or { scrapped:
    // "invite", org: { slug, name } }
    scrap: function(code, userCreds, callback){
      return call({
        url: "/scrap",
        method: "POST",
        data: { code: code },
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

    // list(creds, cb)                       every domain the account reaches
    // list({ limit, offset, org }, creds, cb) a page of them, or one org's;
    //                                        cb(error, domains, total)
    // list(domain, creds, cb)                a domain's revisions
    list: function(projectDomain, userCreds, callback){
      if (!callback){
        callback = userCreds
        userCreds = projectDomain
        projectDomain = null
      }
      var opts = projectDomain && typeof projectDomain === "object" ? projectDomain : null
      if (opts) projectDomain = null
      var u = projectDomain 
        ? "/" + projectDomain + "/list"
        : "/list"
      if (opts){
        var query = ["limit", "offset", "org"].filter(function(k){
          return opts[k] !== undefined && opts[k] !== null
        }).map(function(k){
          return k + "=" + encodeURIComponent(opts[k])
        })
        if (query.length) u = u + "?" + query.join("&")
      }
      return call({
        url: u,
        method: "GET",
        auth: creds(userCreds)
      }, function(error, data, headers){
        if (error || projectDomain) return callback(error, data)
        var total = parseInt((headers || {})["x-total-count"], 10)
        callback(null, data, isNaN(total) ? (data || []).length : total)
      })
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
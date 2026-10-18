// What goes into a project, decided once for every client (slushi
// plans/single-file.md, plans/drop.md). No fs and no Buffer, so a browser
// uses it as is; stream.js supplies the file system around it, a drop
// page would supply the browser's file APIs.
//
//   single(name)          a one-file project: { as } its name at the root,
//                         or { refused } the reason it can't be published
//   ignorer(text)         the ignore filter: surge's defaults, plus a
//                         project's .surgeignore text when it has one
//   references(html)      relative src/href paths in a page, the files it
//                         uses that publishing it alone would leave behind

var Ignore      = require("ignore")
var surgeIgnore = require("surge-ignore")

// a project of exactly one file publishes at the root. One row per type;
// a type without a row is refused before anything uploads
var SINGLE = [
  { test: /\.html?$/i, as: "index.html" }
]

exports.single = function(name){
  var rule = SINGLE.filter(function(r){ return r.test.test(name) })[0]
  if (rule) return { as: rule.as }
  return { refused: "A project is a directory - put " + name + " in a folder and publish the folder." }
}

exports.ignorer = function(surgeignoreText){
  var ig = Ignore().add(surgeIgnore)
  if (surgeignoreText) ig.add(surgeignoreText)
  return ig
}

// relative to the page's folder, without query or fragment, decoded,
// deduplicated, at most 200 (callers keep the ones that exist). "/x"
// counts: it names the domain's root, which is where the page goes.
// Anything with a scheme, or protocol-relative ("//host/x"), points
// elsewhere
exports.references = function(html){
  var seen = {}, out = []
  var re = /\b(?:src|href)\s*=\s*["']([^"'#?]+)/gi, m
  while ((m = re.exec(String(html))) && out.length < 200){
    var ref = m[1].trim()
    if (!ref || /^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.indexOf("//") === 0) continue
    try { ref = decodeURIComponent(ref) } catch(e){}
    ref = ref.replace(/^\/+/, "")
    if (!ref || seen[ref]) continue
    seen[ref] = true
    out.push(ref)
  }
  return out
}

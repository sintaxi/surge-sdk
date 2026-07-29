#!/usr/bin/env node

// compares two golden journals record by record and prints every divergence.
//
//   node test/golden/diff.js [baseline.json] [candidate.json]
//
// exits 1 when anything differs, so it can gate a release.

var fs   = require("fs")
var path = require("path")

var load = function(file){
  if (!fs.existsSync(file)){
    console.error("golden: missing " + file)
    process.exit(2)
  }
  return JSON.parse(fs.readFileSync(file, "utf8")).journal
}

var baselineFile  = process.argv[2] || path.join(__dirname, "axios-baseline.json")
var candidateFile = process.argv[3] || path.join(__dirname, "candidate.json")

var baseline  = load(baselineFile)
var candidate = load(candidateFile)

// seq is positional bookkeeping, not behavior
var strip = function(record){
  var copy = JSON.parse(JSON.stringify(record))
  delete copy.seq
  return copy
}

var label = function(record){
  if (record.kind === "http") return record.method + " " + record.path
  return record.kind + " " + record.method
}

var differences = []

// an emitter sequence with one event added or removed would otherwise cascade
// into a diff on every later index; report the sequence as a whole instead
var isEventList = function(v){
  return Array.isArray(v) && v.length && v[0] && typeof v[0] === "object" && "event" in v[0]
}

var names = function(list){
  return list.map(function(e){ return e.event }).join(" -> ")
}

// header lists are unordered sets. comparing them positionally turns one
// removed header into a diff on every later index.
var isStringList = function(v){
  return Array.isArray(v) && v.every(function(s){ return typeof s === "string" })
}

var missing = function(from, other){
  return from.filter(function(s){ return other.indexOf(s) === -1 })
}

var walk = function(a, b, trail){
  if (JSON.stringify(a) === JSON.stringify(b)) return

  if (isEventList(a) && isEventList(b) && a.length !== b.length){
    differences.push({ at: trail + " (sequence)", baseline: names(a), candidate: names(b) })
    return
  }

  if (isStringList(a) && isStringList(b)){
    var removed = missing(a, b)
    var added   = missing(b, a)
    if (removed.length || added.length){
      differences.push({ at: trail, baseline: "-" + JSON.stringify(removed), candidate: "+" + JSON.stringify(added) })
    }
    return
  }

  var aObj = a && typeof a === "object"
  var bObj = b && typeof b === "object"
  if (!aObj || !bObj || Array.isArray(a) !== Array.isArray(b)){
    differences.push({ at: trail, baseline: a, candidate: b })
    return
  }

  var keys = {}
  Object.keys(a).forEach(function(k){ keys[k] = true })
  Object.keys(b).forEach(function(k){ keys[k] = true })
  Object.keys(keys).sort().forEach(function(k){
    walk(a[k], b[k], trail + (Array.isArray(a) ? "[" + k + "]" : "." + k))
  })
}

var count = Math.max(baseline.length, candidate.length)
for (var i = 0; i < count; i++){
  var a = baseline[i]
  var b = candidate[i]

  if (!a){ differences.push({ at: "#" + i, baseline: "(none)", candidate: label(b) }); continue }
  if (!b){ differences.push({ at: "#" + i, baseline: label(a), candidate: "(none)" }); continue }

  // a kind/method mismatch means the sequences have drifted apart; everything
  // after it would be noise, so stop rather than print hundreds of lines
  if (a.kind !== b.kind || a.method !== b.method){
    differences.push({ at: "#" + i, baseline: label(a), candidate: label(b), fatal: true })
    break
  }

  walk(strip(a), strip(b), "#" + i + " " + label(a))
}

console.log("baseline  " + baselineFile + "  (" + baseline.length + " records)")
console.log("candidate " + candidateFile + "  (" + candidate.length + " records)")
console.log("")

if (!differences.length){
  console.log("identical — no behavior change")
  process.exit(0)
}

differences.forEach(function(d){
  console.log((d.fatal ? "SEQUENCE DRIFT " : "") + d.at)
  console.log("  baseline:  " + JSON.stringify(d.baseline))
  console.log("  candidate: " + JSON.stringify(d.candidate))
  if (d.fatal) console.log("  (stopped — later records would be noise)")
})

console.log("")
console.log(differences.length + " difference(s) — each must map to a C1-C7 entry in the plan")
process.exit(1)

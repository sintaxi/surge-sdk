// The upload format, and only the writing half of it: regular files in a
// tar archive (slushi plans/single-file.md). No fs, no node-tar and no
// Buffer, so the same code runs in Node and in a browser. stream.js wraps
// it with the file system; a browser would wrap it with its file APIs.
//
// It writes exactly what node-tar 7 wrote for surge-stream before
// (tar.c({ portable: true, mtime: new Date(0) })): the same USTAR header
// fields, the same prefix split for long paths, the same PAX header when a
// path doesn't fit or isn't ASCII, the same padding and end blocks. The
// tests compare the two byte for byte, and extract both with the server's
// own extractor.
//
//   header(path, size, mode)   bytes before a file's content: a PAX header
//                              when needed, then the file's 512-byte header
//   padding(size)              zeros after the content, to the next block
//   end()                      the two zero blocks that close the archive

var BLOCK = 512

var encoder = new TextEncoder()
var utf8 = function(str){ return encoder.encode(str) }
var byteLength = function(str){ return utf8(str).length }

// the largest number a null-terminated octal field holds, by width
var MAXNUM = { 12: 8589934591, 8: 2097151 }

// node-tar's octal: zero-padded, then a space and a NUL - except a number
// that already fills the field, which gets only the NUL
var octal = function(num, size){
  var str = Math.floor(num).toString(8)
  if (str.length === size - 1) return str + "\0"
  return new Array(size - str.length - 1).join("0") + str + " \0"
}

var writeAscii = function(buf, off, str){
  for (var i = 0; i < str.length; i++) buf[off + i] = str.charCodeAt(i)
}

// a string into a fixed field, whole characters only (as Buffer.write
// does), NUL-padded. true when it couldn't be stored faithfully: too long,
// or not ASCII
var writeString = function(buf, off, size, str){
  if (str === undefined) return false
  var at = 0
  for (var ch of str){
    var bytes = utf8(ch)
    if (at + bytes.length > size) break
    buf.set(bytes, off + at)
    at += bytes.length
  }
  return str.length !== byteLength(str) || str.length > size
}

var writeNumber = function(buf, off, size, num){
  if (num === undefined) return false
  if (num > MAXNUM[size] || num < 0) throw new Error("tar field overflow: " + num)
  writeAscii(buf, off, octal(num, size))
  return false
}

// posix path helpers, as node-tar uses them
var dirname = function(p){
  var i = p.lastIndexOf("/")
  if (i === -1) return "."
  if (i === 0) return "/"
  return p.slice(0, i)
}
var basename = function(p){ return p.slice(p.lastIndexOf("/") + 1) }
var join = function(a, b){ return a === "." ? b : a + "/" + b }

// a path that's too long for the 100-byte name field moves its leading
// directories into the 155-byte prefix field. [name, prefix, needsPax]
var splitPrefix = function(p){
  var size = 100, prefixSize = 155
  if (byteLength(p) < size) return [p, "", false]
  var name = basename(p), prefix = dirname(p)
  var root = p.charAt(0) === "/" ? "/" : "."
  do {
    if (byteLength(name) <= size && byteLength(prefix) <= prefixSize) return [name, prefix, false]
    if (byteLength(name) > size && byteLength(prefix) <= prefixSize) return [name.slice(0, size - 1), prefix, true]
    name = join(basename(prefix), name)
    prefix = dirname(prefix)
  } while (prefix !== root)
  return [p.slice(0, size - 1), "", true]
}

// one 512-byte header block. f: { path, mode, size, type, uname, gname,
// devmaj, devmin, linkpath } (undefined fields stay NUL; node-tar leaves
// owner, group and link fields empty in portable mode, and writes the
// device numbers as 0).
// true when a PAX header has to carry what didn't fit
var encode = function(buf, off, f){
  var split = splitPrefix(f.path)
  var needPax = split[2]
  needPax = writeString(buf, off, 100, split[0]) || needPax
  needPax = writeNumber(buf, off + 100, 8, f.mode) || needPax
  needPax = writeNumber(buf, off + 124, 12, f.size) || needPax
  needPax = writeNumber(buf, off + 136, 12, 0) || needPax
  buf[off + 156] = f.type.charCodeAt(0)
  needPax = writeString(buf, off + 157, 100, f.linkpath) || needPax
  writeAscii(buf, off + 257, "ustar\u000000")
  needPax = writeString(buf, off + 265, 32, f.uname) || needPax
  needPax = writeString(buf, off + 297, 32, f.gname) || needPax
  needPax = writeNumber(buf, off + 329, 8, f.devmaj) || needPax
  needPax = writeNumber(buf, off + 337, 8, f.devmin) || needPax
  needPax = writeString(buf, off + 345, 155, split[1]) || needPax
  var sum = 8 * 0x20
  for (var i = off; i < off + 148; i++) sum += buf[i]
  for (var j = off + 156; j < off + BLOCK; j++) sum += buf[j]
  writeAscii(buf, off + 148, octal(sum, 8))
  return needPax
}

// "<len> key=value\n", where len counts its own digits
var paxField = function(key, value){
  var s = " " + key + "=" + value + "\n"
  var len = byteLength(s)
  var digits = Math.floor(Math.log(len) / Math.log(10)) + 1
  if (len + digits >= Math.pow(10, digits)) digits += 1
  return (digits + len) + s
}

var paxHeader = function(path, size){
  var body = utf8(paxField("path", path) + paxField("mtime", 0) + paxField("size", size))
  var buf = new Uint8Array(BLOCK * Math.ceil(1 + body.length / BLOCK))
  encode(buf, 0, {
    path: ("PaxHeader/" + basename(path)).slice(0, 99),
    mode: 0o644, size: body.length, type: "x",
    linkpath: "", uname: "", gname: "", devmaj: 0, devmin: 0
  })
  buf.set(body, BLOCK)
  return buf
}

// node-tar's portable mode: permission bits only, owner read/write always,
// never group/other write
var portableMode = function(mode){
  return ((mode & 0o7777) | 0o600) & ~0o22
}

exports.header = function(path, size, mode){
  var block = new Uint8Array(BLOCK)
  var needPax = encode(block, 0, {
    path: path, mode: portableMode(mode === undefined ? 0o644 : mode), size: size, type: "0",
    devmaj: 0, devmin: 0
  })
  if (!needPax) return block
  var pax = paxHeader(path, size)
  var out = new Uint8Array(pax.length + BLOCK)
  out.set(pax, 0)
  out.set(block, pax.length)
  return out
}

exports.padding = function(size){
  return new Uint8Array((BLOCK - size % BLOCK) % BLOCK)
}

exports.end = function(){
  return new Uint8Array(BLOCK * 2)
}

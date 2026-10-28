# surge-stream

> JavaScript stream library for publishing to surge.sh

Used by https://github.com/sintaxi/surge

## Publishing files from memory

A project that isn't on disk (held in a database, say) publishes with
`publishEntries`: the same carry, tar, gzip and events as `publish`, and
nothing read from or written to the file system.

```js
var stream = require("surge-stream")({ endpoint: "https://surge.surge.sh" })

stream.publishEntries([
  { name: "index.html", size: 11, content: Buffer.from("<h1>hi</h1>") },
  // content may be a function, called when the file is packed; a sha256
  // the caller already has spares carry from reading it
  { name: "app.js", size: 17, sha256: "…", content: function(){ return load("app.js") } }
], "example.surge.sh", token, { "file-count": "2" })
  .on("info", function(info){ /* published */ })
  .on("fail", function(){ /* not published */ })
```

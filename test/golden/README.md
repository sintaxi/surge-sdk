# golden capture

A behavioral baseline for the transport layer. Records what the sdk and stream
actually do — on the wire, in callbacks, and in emitter events — so a rewrite
can be proved equivalent instead of assumed equivalent.

Built to prove the axios removal (`slushi/plans/drop-axios.md`) changed nothing
it was not meant to. `baseline.json` now records the **current** implementation
— surge-sdk on fetch, surge-stream on raw `http`/`https` — so a clean
`golden:verify` means today's behaviour, not the pre-migration behaviour.

Re-record it whenever a change to the transport is intended, and only then:
a baseline that no longer matches reality reports differences on every run,
and a check that always fails is a check nobody reads.

## Use

Needs a local slushi on `:5001` (`cd ../slushi && npm start`).

    npm run golden          # record -> test/golden/baseline.json
    npm run golden:verify   # record -> candidate.json, then diff against the baseline

`golden:verify` exits non-zero on any divergence, so it can gate a release.
Every difference it reports must map to a deliberate C1–C7 change in the plan;
anything else is a bug.

To diff two arbitrary journals:

    node test/golden/diff.js baseline.json candidate.json

## How it works

`capture.js` is a mocha root-hook plugin doing two things at once:

- a pass-through proxy on `:5002` forwards to slushi on `:5001`, taping the real
  wire request and response of every call
- the sdk factory is swapped in `require.cache` for a wrapper that tapes every
  callback invocation and every emitter event

Both append to one ordered journal, written on exit. The test files are
untouched — they pick the wrapper up through their own plain
`require("../sdk")`.

## What is recorded

Shape, not values. The suite mints a fresh timestamped account and random
domains on every run, so recording values would produce a journal that never
matches itself. Paths are normalized (`/<domain>/status`), bodies become key
sets, and volatile ids collapse to placeholders.

What is kept verbatim is the part that is contract:

- HTTP status codes
- emitter event names, in order
- string event payloads — these are the `reason` header contract
  (`"Unauthorized"`, `"Forbidden"`, `"Rate limited. Try again later."`)
- the `version` header
- the ordered list of NDJSON line types in each publish/encrypt/ssl handshake
- whether basic auth carried a set, empty, or absent secret — a naive rewrite
  sends the literal string `"undefined"` as the password, and this catches it

Event payloads are summarized synchronously at emit time on purpose:
`handleResponseData` emits `data` with `type` still on the object, then deletes
it before re-emitting under that name. Reading later would see the mutated
object and lose the invariant that `surge ssl` depends on. In the journal it
shows up as `data {…,type} -> progress {…}`.

## Rate limits — read this before trusting a failing run

slushi caps publishes at **240 per 15 minutes per IP, halved to 120 for
unverified accounts** — which every test account is (`slushi.js:3368`). A full
suite spends ~30 publishes, so about **3–4 full runs per 15 minutes**.

Past that, publishes come back 429 and tests fail in a way that looks exactly
like a transport bug. The window is hard: attempts count, so re-running pushes
the reset further out. Before diagnosing anything, check:

    redis-cli -p 6379 TTL "limit:rl:::ffff:127.0.0.1:publish"
    redis-cli -p 6379 HGETALL "rl:hits:$(date +%Y-%m-%d)"

While iterating on the rewrite, run single test files rather than the full
suite.

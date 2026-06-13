# tests/qc/javascript.md — JavaScript (Node 22) capability checklist

Scope: run-only smoke + language showcase + sandbox. JavaScript is **run-only** (no debugger);
the Debug button is hidden via `LANGUAGE_CAPABILITIES.debug=false`.
Runner: `node /workspace/main.js` (interpreted, no compile phase) — see
[`docker/runner-javascript/run-javascript`](../../docker/runner-javascript/run-javascript).
Image: `node:22-bookworm-slim`. Entry file: `main.js`.

> 12-field template, compact form. Code inline. Sandbox: `NetworkMode: none`, `ReadonlyRootfs`.

---

### TC-JS-001 — Hello + process.argv

Tags: js, basic, argv · Pre: fresh · Flags: n/a.
Stdin: (empty) · Argv: `alpha beta`.

```javascript
console.log("argc=", process.argv.length);
process.argv.forEach((a, i) => console.log(i, a));
```

Expected: `argc= 4`; `process.argv[0]` is the node binary path, `[1]` is `/workspace/main.js`, `[2]=alpha`, `[3]=beta`.
Pass: [ ] argc=4 · [ ] index 2/3 are `alpha`/`beta` · [ ] index 1 is `/workspace/main.js`.

---

### TC-JS-002 — stdin multi-line read

Tags: js, stdin · Flags: n/a.
Stdin:
```
line1
line2
line3
```
Argv: (empty).

```javascript
const data = require("fs").readFileSync(0, "utf8");
data.split(/\r?\n/).filter(Boolean).forEach((l, i) => console.log(`[${i}]=${l}`));
```

Expected: `[0]=line1\n[1]=line2\n[2]=line3\n`.
Pass: [ ] 3 lines · [ ] content correct.

---

### TC-JS-003 — stderr separated from stdout

Tags: js, stderr · Flags: n/a · Stdin/Argv: empty.

```javascript
console.log("to stdout");
console.error("to stderr");
```

Expected: `to stdout` on the Output (stdout) stream; `to stderr` on the Diagnostics (stderr) stream.
Pass: [ ] stdout has only `to stdout` · [ ] stderr has `to stderr`.

---

### TC-JS-004 — Exit code 42

Tags: js, exit · Flags: n/a · Stdin/Argv: empty.

```javascript
console.log("before");
process.exit(42);
```

Expected: prints `before`, process exits with code 42.
Pass: [ ] exit code 42 reported.

---

### TC-JS-005 — Syntax error (load-time)

Tags: js, error · Flags: n/a · Stdin/Argv: empty.

```javascript
function broken( {
  console.log("never runs");
}
```

Expected: a `SyntaxError` on stderr, non-zero exit. (Interpreted — no compile phase event; the error surfaces in the run phase.)
Pass: [ ] stderr shows `SyntaxError` · [ ] non-zero exit.

---

### TC-JS-006 — Uncaught runtime error

Tags: js, error, crash · Flags: n/a · Stdin/Argv: empty.

```javascript
function boom() {
  throw new Error("kaboom");
}
boom();
```

Expected: stack trace with `Error: kaboom` on stderr, non-zero exit.
Pass: [ ] stderr contains `kaboom` · [ ] non-zero exit.

---

### TC-JS-007 — Closures / higher-order

Tags: js, closure · Flags: n/a · Stdin/Argv: empty.

```javascript
function counter() {
  let n = 0;
  return () => ++n;
}
const c = counter();
console.log(c(), c(), c());
```

Expected: `1 2 3\n`. Pass: [ ] output correct.

---

### TC-JS-008 — async/await + Promise.all

Tags: js, async · Flags: n/a · Stdin/Argv: empty.

```javascript
const wait = (ms, v) => new Promise((r) => setTimeout(() => r(v), ms));
(async () => {
  const r = await Promise.all([wait(10, 1), wait(5, 2), wait(1, 3)]);
  console.log(r);
})();
```

Expected: `[ 1, 2, 3 ]\n` (Promise.all preserves input order). Pass: [ ] output correct.

---

### TC-JS-009 — JSON round-trip

Tags: js, json · Flags: n/a · Stdin/Argv: empty.

```javascript
const o = { a: 1, b: [2, 3], c: "x" };
const s = JSON.stringify(o);
console.log(s);
console.log(JSON.parse(s).b[1]);
```

Expected: `{"a":1,"b":[2,3],"c":"x"}\n3\n`. Pass: [ ] output correct.

---

### TC-JS-010 — Map / Set

Tags: js, collections · Flags: n/a · Stdin/Argv: empty.

```javascript
const m = new Map([["a", 1], ["b", 2]]);
const s = new Set([1, 1, 2, 3]);
console.log([...m.keys()].join(","), m.get("b"), [...s].join(","));
```

Expected: `a,b 2 1,2,3\n`. Pass: [ ] output correct.

---

### TC-JS-011 — Array map/filter/reduce

Tags: js, array · Flags: n/a · Stdin/Argv: empty.

```javascript
const r = [1, 2, 3, 4, 5].filter((x) => x % 2).map((x) => x * x).reduce((a, b) => a + b, 0);
console.log(r);
```

Expected: `35\n` (odds 1,3,5 → 1,9,25 → 35). Pass: [ ] output correct.

---

### TC-JS-012 — Destructuring + template literal

Tags: js, syntax · Flags: n/a · Stdin/Argv: empty.

```javascript
const user = { name: "Ada", langs: ["js", "c"] };
const { name, langs: [first] } = user;
console.log(`${name} -> ${first}`);
```

Expected: `Ada -> js\n`. Pass: [ ] output correct.

---

### TC-JS-013 — Network blocked (NetworkDisabled)

Tags: js, network, abuse · Flags: n/a · Stdin/Argv: empty.

```javascript
fetch("https://example.com")
  .then((r) => console.log("OK", r.status))
  .catch((e) => console.log("FAIL", e.constructor.name));
```

Expected: `FAIL TypeError` (Node's global `fetch` rejects with `TypeError: fetch failed` when the network is off).
Pass: [ ] line starts with `FAIL`.

---

### TC-JS-014 — Debug button hidden (run-only)

Tags: js, ui, capability · Flags: n/a · Stdin/Argv: empty · Source: n/a.

UI Steps: select **JavaScript** in the language picker.
Expected: the **Debug** button is disabled/hidden (capability `debug:false`); only **Run** is actionable.
Pass: [ ] Debug not actionable for JavaScript.

---

## Summary javascript.md

- 14 scenarios (TC-JS-001..014): IO basics (argv/stdin/stderr/exit), syntax + runtime errors, showcase (closures/async/JSON/Map-Set/array/destructuring), network-blocked, and the run-only Debug-hidden check.
- Self-verification before commit: every Source block passes `node --check` and runs under `node:22`.

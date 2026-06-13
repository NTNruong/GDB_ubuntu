# tests/qc/rust.md — Rust capability checklist

Scope: run smoke + language showcase + sandbox + **DAP debugging** (Phase 3a). Rust is
**run + debug**: debugging reuses the gdb DAP path (rustc emits DWARF).
Runner — run: `rustc -O main.rs -o /exec/program` then execute
([`docker/runner-rust/run-rust`](../../docker/runner-rust/run-rust)); debug: `rustc -g -C opt-level=0`
then `gdb --interpreter=dap` ([`docker/runner-rust/debug-dap-rust`](../../docker/runner-rust/debug-dap-rust)).
Image: `rust:1-bookworm` + `gdb`. Entry: `main.rs`.

> 12-field template, compact form. Debug scenarios use the same DAP UI as C/C++.

---

### TC-RUST-001 — Hello + std::env::args

Tags: rust, basic, argv · Pre: fresh · Flags: `rustc -O` · Stdin: (empty) · Argv: `alpha beta`.

```rust
fn main() {
    let args: Vec<String> = std::env::args().collect();
    println!("argc={}", args.len());
    for (i, a) in args.iter().enumerate() {
        println!("{} {}", i, a);
    }
}
```

Expected: `argc=3`; `args[0]` is the program path (`/exec/program`), `[1]=alpha`, `[2]=beta`.
Pass: [ ] argc=3 · [ ] index 1/2 are `alpha`/`beta`.

---

### TC-RUST-002 — stdin multi-line

Tags: rust, stdin · Flags: `rustc -O`.
Stdin:
```
line1
line2
line3
```
Argv: (empty).

```rust
use std::io::{self, BufRead};

fn main() {
    for (i, line) in io::stdin().lock().lines().enumerate() {
        println!("[{}]={}", i, line.unwrap());
    }
}
```

Expected: `[0]=line1\n[1]=line2\n[2]=line3\n`. Pass: [ ] 3 lines correct.

---

### TC-RUST-003 — stderr separated from stdout

Tags: rust, stderr · Stdin/Argv: empty.

```rust
fn main() {
    println!("to stdout");
    eprintln!("to stderr");
}
```

Expected: `to stdout` on stdout, `to stderr` on stderr. Pass: [ ] streams separated.

---

### TC-RUST-004 — Exit code 42

Tags: rust, exit · Stdin/Argv: empty.

```rust
fn main() {
    println!("before");
    std::process::exit(42);
}
```

Expected: prints `before`, exit code 42. Pass: [ ] exit code 42.

---

### TC-RUST-005 — Compile error

Tags: rust, error, compile · Stdin/Argv: empty.

```rust
fn main() {
    let x: i32 = ;
}
```

Expected: a `compile` phase event then a rustc error on stderr, non-zero exit (no run phase).
Pass: [ ] compile error shown · [ ] program never runs.

---

### TC-RUST-006 — Runtime panic (index out of bounds)

Tags: rust, error, crash · Stdin/Argv: empty.

```rust
fn main() {
    let v: Vec<i32> = vec![1, 2, 3];
    println!("{}", v[10]);
}
```

Expected: `thread 'main' panicked ... index out of bounds` on stderr, non-zero exit.
Pass: [ ] stderr contains `panicked` · [ ] non-zero exit.

---

### TC-RUST-007 — Ownership + iterator chain

Tags: rust, iterators · Stdin/Argv: empty.

```rust
fn main() {
    let v = vec![1, 2, 3, 4, 5];
    let sum: i32 = v.iter().filter(|&&x| x % 2 == 1).map(|&x| x * x).sum();
    println!("{}", sum);
}
```

Expected: `35\n` (odds 1,3,5 → 1+9+25). Pass: [ ] output 35.

---

### TC-RUST-008 — Enum + match

Tags: rust, enum, match · Stdin/Argv: empty.

```rust
enum Shape {
    Circle(f64),
    Rect(f64, f64),
}

fn area(s: &Shape) -> f64 {
    match s {
        Shape::Circle(r) => 3.14159 * r * r,
        Shape::Rect(w, h) => w * h,
    }
}

fn main() {
    println!("{:.2}", area(&Shape::Rect(3.0, 4.0)));
}
```

Expected: `12.00\n`. Pass: [ ] output correct.

---

### TC-RUST-009 — Traits + generics

Tags: rust, traits, generics · Stdin/Argv: empty.

```rust
trait Greet {
    fn greet(&self) -> String;
}
struct En;
struct Vi;
impl Greet for En {
    fn greet(&self) -> String { "hello".into() }
}
impl Greet for Vi {
    fn greet(&self) -> String { "xin chao".into() }
}
fn say<T: Greet>(t: &T) {
    println!("{}", t.greet());
}

fn main() {
    say(&En);
    say(&Vi);
}
```

Expected: `hello\nxin chao\n`. Pass: [ ] output correct.

---

### TC-RUST-010 — Result / Option + `?`

Tags: rust, result · Stdin/Argv: empty.

```rust
fn parse_sum(a: &str, b: &str) -> Result<i32, std::num::ParseIntError> {
    Ok(a.parse::<i32>()? + b.parse::<i32>()?)
}

fn main() {
    println!("{:?}", parse_sum("20", "22"));
    println!("{:?}", parse_sum("x", "1"));
}
```

Expected: `Ok(42)` then `Err(ParseIntError { .. })`. Pass: [ ] first line `Ok(42)` · [ ] second line starts `Err(`.

---

### TC-RUST-011 — Multi-file (`mod`)

Tags: rust, multifile · Stdin/Argv: empty.
Files: `main.rs` + `util.rs`.

```rust
// main.rs
mod util;

fn main() {
    println!("{}", util::greet("world"));
}
```
```rust
// util.rs
pub fn greet(n: &str) -> String {
    format!("hello {}", n)
}
```

Expected: `hello world\n` (rustc compiles the crate root and pulls in `util` via `mod`). Pass: [ ] output correct.

---

### TC-RUST-012 — Network blocked (NetworkDisabled)

Tags: rust, network, abuse · Stdin/Argv: empty.

```rust
use std::net::TcpStream;

fn main() {
    match TcpStream::connect("93.184.216.34:80") {
        Ok(_) => println!("OK"),
        Err(_) => println!("FAIL"),
    }
}
```

Expected: `FAIL\n` (connect fails — no network). Pass: [ ] output `FAIL`.

---

### TC-RUST-013 — Debug: breakpoint + step over

Tags: rust, debug, breakpoint · Stdin/Argv: empty.

```rust
fn main() {
    let mut total = 0;
    for i in 1..=5 {
        total += i; // breakpoint here
    }
    println!("total={}", total);
}
```

UI Steps: set a breakpoint on `total += i;`, click **Debug**. The initial entry stop (in the Rust runtime shim) auto-continues; expect a stop on the breakpoint line. **Step Over** a few times, then **Continue**.
Expected: stops on the breakpoint line; stepping advances line-by-line; final stdout `total=15`.
Pass: [ ] stops at the user line · [ ] stepping advances · [ ] output `total=15`.

---

### TC-RUST-014 — Debug: inspect locals

Tags: rust, debug, variables · Stdin/Argv: empty. Source: same as TC-RUST-013.

UI Steps: at the breakpoint, open the **Variables** panel.
Expected: locals `total` and `i` are listed with current values that change as you step. (Note: `Vec`/`String` render raw — no rust-gdb pretty-printers in this first cut.)
Pass: [ ] `total`/`i` shown · [ ] values update while stepping.

---

### TC-RUST-015 — Debug: call stack + continue

Tags: rust, debug, stack · Stdin/Argv: empty.

```rust
fn square(n: i32) -> i32 {
    let r = n * n; // breakpoint here
    r
}

fn main() {
    println!("{}", square(6));
}
```

UI Steps: breakpoint on `let r = n * n;`, **Debug**, inspect the **Call Stack**, then **Continue**.
Expected: the stack shows `square` (top) called from `main`; Continue runs to completion with stdout `36`.
Pass: [ ] stack shows square + main · [ ] continue prints `36`.

---

### TC-RUST-016 — Debug: evaluate / watch expression

Tags: rust, debug, watch · Stdin/Argv: empty. Source: same as TC-RUST-015.

UI Steps: at the breakpoint, evaluate `n * 2` (or add a watch on `r`).
Expected: evaluating `n * 2` returns `12`; a watch on `r` updates after the assignment line.
Pass: [ ] evaluate returns `12` · [ ] watch shows a value.

---

## Summary rust.md

- 16 scenarios (TC-RUST-001..016): IO basics, compile + panic errors, showcase (iterators/enums/traits/Result/multi-file), network-blocked, and **DAP debugging** (breakpoint/step, locals, call stack + continue, evaluate/watch) via the reused gdb path.
- Self-verification before commit: every Source block compiles with `rustc --edition 2021` on `rust:1`.

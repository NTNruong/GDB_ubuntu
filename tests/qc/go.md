# tests/qc/go.md — Go capability checklist

Scope: run-only smoke + language showcase + sandbox. Go is currently **run-only**; debugging
(Delve `dlv dap`) is **planned for Phase 3b**, so the Debug button is hidden today
(`LANGUAGE_CAPABILITIES.debug=false`).
Runner: synthesizes a `go.mod`, keeps the build cache on `/workspace`, then `go build -o /exec/program .`
and runs it — see [`docker/runner-go/run-go`](../../docker/runner-go/run-go).
Image: `golang:1-bookworm` (latest stable). Entry: `main.go` with `package main`.

> 12-field template, compact form. Sandbox: `NetworkMode: none` ⇒ stdlib-only; no external modules.

---

### TC-GO-001 — Hello + os.Args

Tags: go, basic, argv · Pre: fresh · Flags: go build · Stdin: (empty) · Argv: `alpha beta`.

```go
package main

import (
	"fmt"
	"os"
)

func main() {
	fmt.Println("argc=", len(os.Args))
	for i, a := range os.Args {
		fmt.Println(i, a)
	}
}
```

Expected: `argc= 3`; `os.Args[0]` is the program path (`/exec/program`), `[1]=alpha`, `[2]=beta`.
Pass: [ ] argc=3 · [ ] index 1/2 are `alpha`/`beta`.

---

### TC-GO-002 — stdin multi-line (bufio.Scanner)

Tags: go, stdin · Flags: go build.
Stdin:
```
line1
line2
line3
```
Argv: (empty).

```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

func main() {
	sc := bufio.NewScanner(os.Stdin)
	i := 0
	for sc.Scan() {
		fmt.Printf("[%d]=%s\n", i, sc.Text())
		i++
	}
}
```

Expected: `[0]=line1\n[1]=line2\n[2]=line3\n`. Pass: [ ] 3 lines correct.

---

### TC-GO-003 — stderr separated from stdout

Tags: go, stderr · Stdin/Argv: empty.

```go
package main

import (
	"fmt"
	"os"
)

func main() {
	fmt.Println("to stdout")
	fmt.Fprintln(os.Stderr, "to stderr")
}
```

Expected: `to stdout` on stdout, `to stderr` on stderr. Pass: [ ] streams separated.

---

### TC-GO-004 — Exit code 42

Tags: go, exit · Stdin/Argv: empty.

```go
package main

import (
	"fmt"
	"os"
)

func main() {
	fmt.Println("before")
	os.Exit(42)
}
```

Expected: prints `before`, exit code 42. Pass: [ ] exit code 42.

---

### TC-GO-005 — Compile error

Tags: go, error, compile · Stdin/Argv: empty.

```go
package main

func main() {
	x :=
}
```

Expected: a `compile` phase event then a `go build` error on stderr, non-zero exit (no run phase).
Pass: [ ] compile error shown · [ ] program never runs.

---

### TC-GO-006 — Runtime panic (nil deref)

Tags: go, error, crash · Stdin/Argv: empty.

```go
package main

func main() {
	var p *int
	_ = *p
}
```

Expected: `panic: runtime error: invalid memory address or nil pointer dereference` on stderr, non-zero exit.
Pass: [ ] stderr contains `panic` · [ ] non-zero exit.

---

### TC-GO-007 — Goroutines + buffered channel

Tags: go, concurrency · Stdin/Argv: empty.

```go
package main

import (
	"fmt"
	"sort"
)

func main() {
	ch := make(chan int, 3)
	for _, n := range []int{1, 2, 3} {
		go func(n int) { ch <- n * n }(n)
	}
	var got []int
	for i := 0; i < 3; i++ {
		got = append(got, <-ch)
	}
	sort.Ints(got)
	fmt.Println(got)
}
```

Expected: `[1 4 9]\n` (sorted to make the goroutine order deterministic). Pass: [ ] output `[1 4 9]`.

---

### TC-GO-008 — Slices + maps

Tags: go, collections · Stdin/Argv: empty.

```go
package main

import "fmt"

func main() {
	s := []int{1, 2, 3}
	s = append(s, 4)
	m := map[string]int{"a": 1, "b": 2}
	fmt.Println(s, len(s), m["b"])
}
```

Expected: `[1 2 3 4] 4 2\n`. Pass: [ ] output correct.

---

### TC-GO-009 — Struct + method + interface

Tags: go, interface · Stdin/Argv: empty.

```go
package main

import "fmt"

type Shape interface{ Area() int }

type Rect struct{ W, H int }

func (r Rect) Area() int { return r.W * r.H }

func main() {
	var s Shape = Rect{3, 4}
	fmt.Println(s.Area())
}
```

Expected: `12\n`. Pass: [ ] output 12.

---

### TC-GO-010 — stdlib sort + strings

Tags: go, stdlib · Stdin/Argv: empty.

```go
package main

import (
	"fmt"
	"sort"
	"strings"
)

func main() {
	xs := []string{"banana", "apple", "cherry"}
	sort.Strings(xs)
	fmt.Println(strings.Join(xs, ","))
}
```

Expected: `apple,banana,cherry\n`. Pass: [ ] output correct.

---

### TC-GO-011 — Multi-file (same package)

Tags: go, multifile · Stdin/Argv: empty.
Files: `main.go` + `util.go`.

```go
// main.go
package main

import "fmt"

func main() { fmt.Println(greet("world")) }
```
```go
// util.go
package main

func greet(n string) string { return "hello " + n }
```

Expected: `hello world\n` (`go build .` compiles every file in the package). Pass: [ ] output correct.

---

### TC-GO-012 — Network blocked (NetworkDisabled)

Tags: go, network, abuse · Stdin/Argv: empty.

```go
package main

import (
	"fmt"
	"net/http"
)

func main() {
	_, err := http.Get("https://example.com")
	if err != nil {
		fmt.Println("FAIL")
		return
	}
	fmt.Println("OK")
}
```

Expected: `FAIL\n` (dial fails — no network). Pass: [ ] output `FAIL`.

---

### TC-GO-013 — stdlib-only (external import rejected)

Tags: go, sandbox, modules · Stdin/Argv: empty.

```go
package main

import "github.com/sirupsen/logrus"

func main() { logrus.Info("hi") }
```

Expected: `go build` fails offline (`cannot find module providing package …` / `no required module provides package`), non-zero exit — external dependencies cannot be fetched.
Pass: [ ] build fails · [ ] program never runs.

---

### TC-GO-014 — Debug button hidden (run-only; debug = Phase 3b)

Tags: go, ui, capability · Source: n/a.

UI Steps: select **Go**.
Expected: the **Debug** button is disabled/hidden (capability `debug:false`). Go debugging arrives in Phase 3b (Delve `dlv dap` + socat bridge).
Pass: [ ] Debug not actionable for Go.

---

## Summary go.md

- 14 scenarios (TC-GO-001..014): IO basics, compile + panic errors, showcase (goroutines/channels/slices/maps/interface/stdlib/multi-file), network-blocked + stdlib-only sandbox, and the run-only Debug-hidden check.
- Self-verification before commit: every Source block builds with `go build` / `go vet` on `golang:1`.
- **Future:** when Phase 3b lands, add `TC-GO-DBG-###` (breakpoint/step/locals/stack via Delve) and flip TC-GO-014.

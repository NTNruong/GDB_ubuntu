# tests/qc/python.md — Python 3.12 capability checklist

Phạm vi: smoke + asyncio + typing/dataclass + stdlib showcase.
Runner: `python3 -I` (xem [`docker/runner-python/run-python`](../../docker/runner-python/run-python)).
Image pre-installed: `numpy 2.1.3`, `pandas 2.2.3`, `requests 2.32.3`, `debugpy 1.8.20`.

> 12 fields template. Code Python inline.

---

### TC-PY-001 — Hello + sys.argv

Tags: python, basic, argv · Pre: fresh · Flags: n/a.
Stdin: (empty) · Argv: `alpha beta gamma`.

```python
import sys
print("argc=", len(sys.argv))
for i, a in enumerate(sys.argv):
    print(i, a)
```

Expected: `argc= 4\n0 /workspace/main.py\n1 alpha\n2 beta\n3 gamma\n`.
Pass: [ ] argc=4 · [ ] 3 args đúng.

---

### TC-PY-002 — stdin multi-line read

Tags: python, stdin · Flags: n/a.
Stdin:
```
line1
line2
line3
```
Argv: (empty).

```python
import sys
for i, line in enumerate(sys.stdin):
    print(f"[{i}]={line.rstrip()}")
```

Expected: 3 dòng `[0]=line1\n[1]=line2\n[2]=line3\n`.
Pass: [ ] Đếm 3 dòng · [ ] Output đúng.

---

### TC-PY-003 — f-string + format spec

Tags: python, fstring · Flags: n/a · Stdin/Argv: empty.

```python
v = 3.14159265
print(f"pi={v:.4f} pad={v:>10.2f}")
print(f"hex={255:#06x} bin={10:#010b}")
```

Expected: `pi=3.1416 pad=      3.14\nhex=0x00ff bin=0b00001010\n`.
Pass: [ ] Output đúng.

---

### TC-PY-004 — dataclass + slots

Tags: python, dataclass · Flags: n/a · Stdin/Argv: empty.

```python
from dataclasses import dataclass
@dataclass(slots=True, frozen=True)
class Point:
    x: int
    y: int
p = Point(3, 4)
print(p)
try:
    p.x = 99
except AttributeError as e:
    print("frozen:", type(e).__name__)
```

Expected: `Point(x=3, y=4)\nfrozen: AttributeError\n` hoặc `FrozenInstanceError`.
Pass: [ ] In Point · [ ] Có dòng frozen.

---

### TC-PY-005 — typing TypeVar + Generic class

Tags: python, typing · Flags: n/a · Stdin/Argv: empty.

```python
from typing import TypeVar, Generic, List
T = TypeVar("T")
class Stack(Generic[T]):
    def __init__(self) -> None:
        self.items: List[T] = []
    def push(self, x: T) -> None: self.items.append(x)
    def pop(self) -> T: return self.items.pop()

s: Stack[int] = Stack()
s.push(1); s.push(2)
print(s.pop(), s.pop())
```

Expected: `2 1\n`. Pass: [ ] Output đúng.

---

### TC-PY-006 — asyncio.run + coroutine

Tags: python, asyncio · Flags: n/a · Stdin/Argv: empty.

```python
import asyncio
async def main():
    await asyncio.sleep(0)
    print("hello async")
asyncio.run(main())
```

Expected: `hello async\n`. Pass: [ ] Output đúng.

---

### TC-PY-007 — asyncio.gather + cancellation

Tags: python, asyncio, gather · Flags: n/a · Stdin/Argv: empty.

```python
import asyncio
async def worker(n: int) -> int:
    await asyncio.sleep(0.01 * n)
    return n * n
async def main():
    r = await asyncio.gather(worker(1), worker(2), worker(3))
    print(r)
asyncio.run(main())
```

Expected: `[1, 4, 9]\n`. Pass: [ ] Output đúng.

---

### TC-PY-008 — itertools / functools

Tags: python, stdlib · Flags: n/a · Stdin/Argv: empty.

```python
import itertools, functools, operator
print(list(itertools.islice(itertools.count(10), 5)))
print(functools.reduce(operator.mul, [1,2,3,4], 1))
```

Expected: `[10, 11, 12, 13, 14]\n24\n`. Pass: [ ] Output đúng.

---

### TC-PY-009 — collections.OrderedDict / deque / Counter

Tags: python, stdlib · Flags: n/a · Stdin/Argv: empty.

```python
from collections import OrderedDict, deque, Counter
od = OrderedDict([("a",1),("b",2),("c",3)])
dq = deque([1,2,3]); dq.appendleft(0); dq.append(4)
print(list(od.keys()), list(dq), Counter("abracadabra").most_common(2))
```

Expected: `['a', 'b', 'c'] [0, 1, 2, 3, 4] [('a', 5), ('b', 2)]\n`.
Pass: [ ] Output đúng.

---

### TC-PY-010 — numpy import + basic ufunc

Tags: python, numpy · Flags: n/a · Stdin/Argv: empty.

```python
import numpy as np
a = np.array([1, 2, 3, 4, 5])
print(a.mean(), a.sum(), np.dot(a, a))
```

Expected: `3.0 15 55\n`. Pass: [ ] Output đúng.

---

### TC-PY-011 — pandas DataFrame.describe

Tags: python, pandas · Flags: n/a · Stdin/Argv: empty.

```python
import pandas as pd
df = pd.DataFrame({"x": [1,2,3,4,5], "y": [10,20,30,40,50]})
print(df.describe().loc["mean"].to_list())
```

Expected: `[3.0, 30.0]\n`. Pass: [ ] Output đúng.

---

### TC-PY-012 — requests blocked (NetworkDisabled)

Tags: python, network, abuse · Flags: n/a · Stdin/Argv: empty.

```python
import requests
try:
    r = requests.get("https://example.com", timeout=3)
    print("OK", r.status_code)
except Exception as e:
    print("FAIL", type(e).__name__)
```

Expected: `FAIL ConnectionError` (hoặc `gaierror`/`NewConnectionError`).
Pass: [ ] Bắt đầu bằng `FAIL`.

---

### TC-PY-013 — PEP 695 type alias (Python 3.12)

Tags: python, typing, pep695 · Flags: n/a · Stdin/Argv: empty.

```python
type Vector = list[float]
def length(v: Vector) -> float:
    return sum(x*x for x in v) ** 0.5
print(round(length([3.0, 4.0]), 4))
```

Expected: `5.0\n`. Pass: [ ] Output đúng.

---

### TC-PY-014 — Pattern matching `match/case` + guard

Tags: python, match · Flags: n/a · Stdin/Argv: empty.

```python
def classify(p):
    match p:
        case (0, 0): return "origin"
        case (x, 0) if x > 0: return "+x-axis"
        case (0, y) if y > 0: return "+y-axis"
        case (x, y): return f"general({x},{y})"
for p in [(0,0), (5,0), (0,3), (1,2)]:
    print(classify(p))
```

Expected: `origin\n+x-axis\n+y-axis\ngeneral(1,2)\n`. Pass: [ ] Output đúng.

---

### TC-PY-015 — traceback formatting + sys.excepthook

Tags: python, traceback · Flags: n/a · Stdin/Argv: empty.

```python
import sys, traceback
def f():
    raise ValueError("custom")
try:
    f()
except Exception:
    tb = traceback.format_exc()
    print("captured")
    print("len_lines=", len(tb.splitlines()))
```

Expected: `captured\nlen_lines= ` số ≥ 3. Pass: [ ] In `captured` · [ ] len_lines ≥ 3.

---

## Tổng kết python.md

- Smoke + showcase: 15 scenario (TC-PY-001..015) phủ basic + typing + asyncio + stdlib + 3rd-party (numpy/pandas/requests) + Python 3.12 features (PEP 695, match).

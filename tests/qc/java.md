# tests/qc/java.md — Java capability checklist

Scope: run-only smoke + **version selector (17 / 21 / 25)** + language showcase + sandbox. Java is
**run-only** (no debugger); the Debug button is hidden via `LANGUAGE_CAPABILITIES.debug=false`.
Runner: `javac *.java -d classes` then `java -cp classes Main`, JDK chosen by `JAVA_VERSION` — see
[`docker/runner-java/run-java`](../../docker/runner-java/run-java).
Image: one `runner-java` image bundling **Temurin JDK 17 / 21 / 25** (default 21). Entry: `Main.java`
with `public class Main`.

> 12-field template, compact form. The version dropdown only appears for Java.

---

### TC-JAVA-001 — Hello + args

Tags: java, basic, argv · Pre: fresh · Flags: javac default · Version: 21.
Stdin: (empty) · Argv: `alpha beta`.

```java
public class Main {
    public static void main(String[] args) {
        System.out.println("argc=" + args.length);
        for (int i = 0; i < args.length; i++) System.out.println(i + " " + args[i]);
    }
}
```

Expected: `argc=2\n0 alpha\n1 beta\n` (Java `args` excludes the program name).
Pass: [ ] argc=2 · [ ] args correct.

---

### TC-JAVA-002 — stdin multi-line (Scanner)

Tags: java, stdin · Version: 21.
Stdin:
```
line1
line2
line3
```
Argv: (empty).

```java
import java.util.Scanner;
public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int i = 0;
        while (sc.hasNextLine()) System.out.println("[" + (i++) + "]=" + sc.nextLine());
    }
}
```

Expected: `[0]=line1\n[1]=line2\n[2]=line3\n`. Pass: [ ] 3 lines correct.

---

### TC-JAVA-003 — stderr separated from stdout

Tags: java, stderr · Version: 21 · Stdin/Argv: empty.

```java
public class Main {
    public static void main(String[] args) {
        System.out.println("to stdout");
        System.err.println("to stderr");
    }
}
```

Expected: `to stdout` on stdout, `to stderr` on stderr. Pass: [ ] streams separated.

---

### TC-JAVA-004 — Exit code 42

Tags: java, exit · Version: 21 · Stdin/Argv: empty.

```java
public class Main {
    public static void main(String[] args) {
        System.out.println("before");
        System.exit(42);
    }
}
```

Expected: prints `before`, exit code 42. Pass: [ ] exit code 42.

---

### TC-JAVA-005 — Compile error (javac)

Tags: java, error, compile · Version: 21 · Stdin/Argv: empty.

```java
public class Main {
    public static void main(String[] args) {
        int x = ;
    }
}
```

Expected: a `compile` phase event (start) then a javac error on stderr, non-zero exit (no run phase).
Pass: [ ] compile error shown · [ ] non-zero exit · [ ] program never runs.

---

### TC-JAVA-006 — Uncaught exception

Tags: java, error, crash · Version: 21 · Stdin/Argv: empty.

```java
public class Main {
    public static void main(String[] args) {
        int[] a = new int[2];
        System.out.println(a[5]);
    }
}
```

Expected: `ArrayIndexOutOfBoundsException` on stderr, non-zero exit.
Pass: [ ] stderr shows the exception · [ ] non-zero exit.

---

### TC-JAVA-007 — Version selector → Java 17

Tags: java, version · **Version: 17** · Stdin/Argv: empty.

```java
public class Main {
    public static void main(String[] args) {
        System.out.println(System.getProperty("java.version"));
    }
}
```

UI Steps: select Java, set the **version dropdown to 17**, Run.
Expected: output starts with `17.` (e.g. `17.0.x`). Pass: [ ] version starts `17.`.

---

### TC-JAVA-008 — Version selector → Java 21 (default)

Tags: java, version · **Version: 21 (default)** · Stdin/Argv: empty. Source: same as TC-JAVA-007.

UI Steps: leave the version at the default (21), Run. Also re-run **without** changing the version to confirm the default.
Expected: output starts with `21.`. Pass: [ ] version starts `21.` · [ ] default (no selection) also runs 21.

---

### TC-JAVA-009 — Version selector → Java 25

Tags: java, version · **Version: 25** · Stdin/Argv: empty. Source: same as TC-JAVA-007.

UI Steps: set the version dropdown to 25, Run.
Expected: output starts with `25.`. Pass: [ ] version starts `25.` · [ ] switching versions changes the printed value.

---

### TC-JAVA-010 — Generics + streams

Tags: java, generics, stream · Version: 21 · Stdin/Argv: empty.

```java
import java.util.*;
import java.util.stream.*;
public class Main {
    public static void main(String[] args) {
        List<Integer> xs = List.of(1, 2, 3, 4, 5);
        int sum = xs.stream().filter(x -> x % 2 == 1).mapToInt(x -> x * x).sum();
        System.out.println(sum);
    }
}
```

Expected: `35\n` (odds 1,3,5 → 1+9+25). Pass: [ ] output 35.

---

### TC-JAVA-011 — Record (JDK 16+)

Tags: java, record · Version: 21 · Stdin/Argv: empty.

```java
public class Main {
    record Point(int x, int y) {}
    public static void main(String[] args) {
        Point p = new Point(3, 4);
        System.out.println(p + " " + (p.x() + p.y()));
    }
}
```

Expected: `Point[x=3, y=4] 7\n`. Pass: [ ] output correct. (Works on all bundled JDKs ≥ 17.)

---

### TC-JAVA-012 — Collectors.joining

Tags: java, stream · Version: 21 · Stdin/Argv: empty.

```java
import java.util.stream.*;
public class Main {
    public static void main(String[] args) {
        String s = Stream.of("a", "bb", "ccc").collect(Collectors.joining(","));
        System.out.println(s);
    }
}
```

Expected: `a,bb,ccc\n`. Pass: [ ] output correct.

---

### TC-JAVA-013 — Multi-file (Main + Helper)

Tags: java, multifile · Version: 21 · Stdin/Argv: empty.
Files: `Main.java` + `Helper.java`.

```java
// Main.java
public class Main {
    public static void main(String[] args) {
        System.out.println(Helper.greet("world"));
    }
}
```
```java
// Helper.java
public class Helper {
    static String greet(String n) { return "hello " + n; }
}
```

Expected: `hello world\n` (`javac` compiles all `*.java`). Pass: [ ] output correct · [ ] both files compiled.

---

### TC-JAVA-014 — Network blocked (NetworkDisabled)

Tags: java, network, abuse · Version: 21 · Stdin/Argv: empty.

```java
import java.net.*;
import java.io.*;
public class Main {
    public static void main(String[] args) {
        try {
            URL u = new URL("https://example.com");
            try (InputStream in = u.openStream()) { System.out.println("OK"); }
        } catch (Exception e) {
            System.out.println("FAIL " + e.getClass().getSimpleName());
        }
    }
}
```

Expected: `FAIL ...` (`UnknownHostException`/`ConnectException`). Pass: [ ] line starts with `FAIL`.

---

### TC-JAVA-015 — Debug button hidden (run-only)

Tags: java, ui, capability · Version: any · Source: n/a.

UI Steps: select **Java**.
Expected: the **Debug** button is disabled/hidden (capability `debug:false`); the **version** dropdown is visible.
Pass: [ ] Debug not actionable · [ ] version dropdown shown for Java.

---

## Summary java.md

- 15 scenarios (TC-JAVA-001..015): IO basics, compile + runtime errors, **version selector 17/21/25** (incl. default-21), showcase (generics/streams/record/Collectors/multi-file), network-blocked, run-only Debug-hidden + version-dropdown-visible checks.
- Self-verification before commit: every Source block compiles with `javac` on JDK 17/21/25.

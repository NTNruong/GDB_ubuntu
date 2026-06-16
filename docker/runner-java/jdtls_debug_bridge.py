#!/usr/bin/env python3
"""Bridge: turn the jdt.ls + java-debug pair into a plain DAP-over-stdio adapter.

Java debug needs TWO protocols: LSP (to ask jdt.ls for a DAP port via the
`vscode.java.startDebugSession` command) and DAP (to the java-debug server that
command spins up inside the jdt.ls JVM). The runner only speaks DAP over the
container's stdio (like Go/Rust), so this script hides the LSP step:

  1. boot jdt.ls (headless) under Java >=21 with the java-debug plugin in `bundles`,
  2. LSP handshake: initialize -> initialized -> wait for ServiceReady,
  3. executeCommand `vscode.java.startDebugSession` -> a loopback DAP port,
  4. relay container stdin/stdout <-> that DAP TCP port (keeping jdt.ls alive).

NOTE: this path cannot be exercised on the Windows dev host (no image build); the
exact jdt.ls launch flags, the ServiceReady notification, and the startDebugSession
command/port shape are the highest-risk unknowns and must be validated on the rootless
host (M1/M2 blocker). Constants below are tunable via env.
"""
import glob
import json
import os
import shutil
import socket
import subprocess
import sys
import threading

JDTLS_HOME = os.environ.get("JDTLS_HOME", "/opt/jdtls")
JAVA_DEBUG_GLOB = os.environ.get("JAVA_DEBUG_JAR", "/opt/java-debug/com.microsoft.java.debug.plugin-*.jar")
JDTLS_JAVA = os.environ.get("JDTLS_JAVA", "/opt/java/21/bin/java")  # jdt.ls requires Java >= 21
WORKSPACE = "/workspace"
WRITABLE_CONFIG = "/workspace/tmp/jdtls-config"  # ReadonlyRootfs: jdt.ls -configuration must be writable
WRITABLE_DATA = "/workspace/tmp/jdtls-data"


def log(msg):
    # jdt.ls/diagnostics go to stderr; stdout is reserved for the DAP byte stream.
    print("[jdtls-bridge] " + msg, file=sys.stderr, flush=True)


def first_glob(pattern):
    matches = sorted(glob.glob(pattern))
    if not matches:
        raise SystemExit("no file matches " + pattern)
    return matches[-1]


# --- LSP framing over jdt.ls stdio ------------------------------------------------

def lsp_write(proc, payload):
    body = json.dumps(payload).encode("utf-8")
    proc.stdin.write(b"Content-Length: %d\r\n\r\n" % len(body))
    proc.stdin.write(body)
    proc.stdin.flush()


def lsp_read(proc):
    headers = {}
    while True:
        line = proc.stdout.readline()
        if not line:
            return None
        line = line.strip()
        if not line:
            break
        if b":" in line:
            k, v = line.split(b":", 1)
            headers[k.strip().lower()] = v.strip()
    length = int(headers.get(b"content-length", b"0"))
    if length == 0:
        return {}
    return json.loads(proc.stdout.read(length).decode("utf-8"))


def start_jdtls():
    launcher = first_glob(os.path.join(JDTLS_HOME, "plugins", "org.eclipse.equinox.launcher_*.jar"))
    # config_linux ships read-only in the image; copy it to a writable path.
    src_config = os.path.join(JDTLS_HOME, "config_linux")
    if not os.path.isdir(WRITABLE_CONFIG):
        shutil.copytree(src_config, WRITABLE_CONFIG)
    os.makedirs(WRITABLE_DATA, exist_ok=True)

    cmd = [
        JDTLS_JAVA,
        "-Declipse.application=org.eclipse.jdt.ls.core.id1",
        "-Dosgi.bundles.defaultStartLevel=4",
        "-Declipse.product=org.eclipse.jdt.ls.core.product",
        "-Dosgi.checkConfiguration=true",
        "-Dosgi.sharedConfiguration.area=" + os.path.join(JDTLS_HOME, "config_linux"),
        "-Dosgi.sharedConfiguration.area.readOnly=true",
        "-Dosgi.configuration.cascaded=true",
        "-Djava.io.tmpdir=/workspace/tmp",
        # jdt.ls is short-lived (one debug session) and CPU-bound at startup: skip the C2
        # JIT, use ParallelGC, pre-size the heap to avoid grow-pauses, and drop perf-data
        # files. The container now has more CPU/RAM (debugJavaNanoCpus/MemoryBytes), so raise
        # -Xmx for fewer GC pauses during import.
        "-XX:TieredStopAtLevel=1",
        "-XX:+UseParallelGC",
        "-XX:-UsePerfData",
        "-Xms256m",
        "-Xmx768m",
        "--add-modules=ALL-SYSTEM",
        "--add-opens", "java.base/java.util=ALL-UNNAMED",
        "--add-opens", "java.base/java.lang=ALL-UNNAMED",
        "-jar", launcher,
        "-configuration", WRITABLE_CONFIG,
        "-data", WRITABLE_DATA,
    ]
    log("starting jdt.ls: " + " ".join(cmd))
    return subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=sys.stderr)


def handshake_for_port(proc):
    java_debug_jar = first_glob(JAVA_DEBUG_GLOB)
    lsp_write(proc, {
        "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": {
            "processId": os.getpid(),
            "rootUri": "file://" + WORKSPACE,
            "rootPath": WORKSPACE,
            "workspaceFolders": [{"uri": "file://" + WORKSPACE, "name": "workspace"}],
            "capabilities": {},
            "initializationOptions": {
                "bundles": [java_debug_jar],
                "extendedClientCapabilities": {"progressReportProvider": False, "classFileContentsSupport": True},
                # Reach ServiceReady sooner: the slow part is jdt.ls's workspace import +
                # build. We compile the user code ourselves (javac -> /workspace/classes) and
                # pass explicit classPaths/sourcePaths in the DAP launch, so jdt.ls's own build
                # output is not on the critical path — disable autobuild + Maven/Gradle import
                # probing (the upstream-recommended way to cut ServiceReady time).
                "settings": {"java": {
                    "autobuild": {"enabled": False},
                    "import": {"gradle": {"enabled": False}, "maven": {"enabled": False}},
                    "maxConcurrentBuilds": 1,
                }},
            },
        },
    })

    port = None
    ready = False
    while True:
        msg = lsp_read(proc)
        if msg is None:
            raise SystemExit("jdt.ls closed during handshake")
        if msg.get("id") == 1 and "result" in msg:
            lsp_write(proc, {"jsonrpc": "2.0", "method": "initialized", "params": {}})
        # jdt.ls signals readiness via language/status {type: "ServiceReady"/"Started"}.
        if msg.get("method") == "language/status":
            status = (msg.get("params") or {}).get("type")
            log("jdt.ls status: " + str(status))
            if status in ("ServiceReady", "Started") and not ready:
                ready = True
                lsp_write(proc, {
                    "jsonrpc": "2.0", "id": 2, "method": "workspace/executeCommand",
                    "params": {"command": "vscode.java.startDebugSession", "arguments": []},
                })
        # Reply to server->client requests jdt.ls may send so it doesn't block.
        if msg.get("method") and "id" in msg and not str(msg.get("method")).startswith("$/"):
            lsp_write(proc, {"jsonrpc": "2.0", "id": msg["id"], "result": None})
        if msg.get("id") == 2 and "result" in msg:
            port = msg["result"]
            break
    if not isinstance(port, int):
        raise SystemExit("startDebugSession did not return a port: " + repr(port))
    return port


def relay(port):
    sock = socket.create_connection(("127.0.0.1", port))
    log("relaying DAP on port %d" % port)

    def pump(src_read, dst_write):
        try:
            while True:
                chunk = src_read(65536)
                if not chunk:
                    break
                dst_write(chunk)
        except OSError:
            pass

    stdin_fd = sys.stdin.buffer
    stdout_fd = sys.stdout.buffer

    def stdout_write(b):
        stdout_fd.write(b)
        stdout_fd.flush()

    t1 = threading.Thread(target=pump, args=(stdin_fd.read1, sock.sendall), daemon=True)
    t2 = threading.Thread(target=pump, args=(sock.recv, stdout_write), daemon=True)
    t1.start()
    t2.start()
    t1.join()
    t2.join()


def main():
    proc = start_jdtls()
    try:
        port = handshake_for_port(proc)
        relay(port)
    finally:
        proc.terminate()


if __name__ == "__main__":
    main()

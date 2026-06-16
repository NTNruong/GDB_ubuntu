# Bundle several Temurin JDKs in one image; the entrypoint picks one per request
# (JAVA_VERSION). Multi-stage COPY pins exact Adoptium builds without an apt repo.
FROM eclipse-temurin:17-jdk AS jdk17
FROM eclipse-temurin:21-jdk AS jdk21
FROM eclipse-temurin:25-jdk AS jdk25

FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

# python3 runs the jdt.ls<->DAP bridge (debug path); curl/unzip fetch the debug adapter.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash coreutils ca-certificates time python3 curl unzip \
  && rm -rf /var/lib/apt/lists/*

# Temurin images install the JDK at /opt/java/openjdk — land each under its version.
COPY --from=jdk17 /opt/java/openjdk /opt/java/17
COPY --from=jdk21 /opt/java/openjdk /opt/java/21
COPY --from=jdk25 /opt/java/openjdk /opt/java/25

# --- Debug adapter: Eclipse JDT Language Server + Microsoft java-debug plugin -------
# jdt.ls provides project model + source lookup; java-debug (loaded as an LSP `bundle`)
# is the DAP server. jdt.ls requires a Java >=21 runtime (the bridge runs it under
# /opt/java/21). VERSIONS ARE PINNED HERE — validate/bump on the rootless host (M1).
ARG JDTLS_TARBALL=https://download.eclipse.org/jdtls/snapshots/jdt-language-server-latest.tar.gz
ARG JAVA_DEBUG_VSIX=https://open-vsx.org/api/vscjava/vscode-java-debug/0.58.1/file/vscjava.vscode-java-debug-0.58.1.vsix
RUN mkdir -p /opt/jdtls /opt/java-debug \
  && curl -fsSL "$JDTLS_TARBALL" -o /tmp/jdtls.tar.gz \
  && tar --no-same-owner -xzf /tmp/jdtls.tar.gz -C /opt/jdtls \
  && curl -fsSL "$JAVA_DEBUG_VSIX" -o /tmp/java-debug.vsix \
  && unzip -q /tmp/java-debug.vsix -d /tmp/java-debug-vsix \
  && cp /tmp/java-debug-vsix/extension/server/com.microsoft.java.debug.plugin-*.jar /opt/java-debug/ \
  && rm -rf /tmp/jdtls.tar.gz /tmp/java-debug.vsix /tmp/java-debug-vsix

# Compile the run-path CPU launcher and the debug-path stdin launcher with the lowest
# bundled JDK (17) so their bytecode loads under whichever JDK (17/21/25) is selected.
COPY _RunnerMain.java /opt/runner/_RunnerMain.java
COPY _DebugMain.java /opt/runner/_DebugMain.java
# -encoding UTF-8: the image has no locale set, so javac defaults to US-ASCII and
# chokes on non-ASCII comment chars (em dash, arrows). Pin UTF-8 explicitly.
RUN /opt/java/17/bin/javac -encoding UTF-8 -d /opt/runner /opt/runner/_RunnerMain.java /opt/runner/_DebugMain.java

COPY jdtls_debug_bridge.py /opt/runner/jdtls_debug_bridge.py
COPY run-java /usr/local/bin/run-java
COPY debug-dap-java /usr/local/bin/debug-dap-java
RUN chmod +x /usr/local/bin/run-java /usr/local/bin/debug-dap-java

WORKDIR /workspace

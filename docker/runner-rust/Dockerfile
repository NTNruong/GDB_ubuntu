# rust:1-trixie: latest stable 1.x toolchain on Debian 13 (trixie), whose apt gdb
# (>= 16) ships the DAP interpreter that debug-dap-rust needs. Bookworm's gdb 13.1
# lacks `--interpreter=dap` ("Interpreter dap unrecognized") — see ISSUE-055.
FROM rust:1-trixie

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash coreutils ca-certificates time gdb \
  && rm -rf /var/lib/apt/lists/*

COPY run-rust /usr/local/bin/run-rust
COPY debug-dap-rust /usr/local/bin/debug-dap-rust
RUN chmod +x /usr/local/bin/run-rust /usr/local/bin/debug-dap-rust

WORKDIR /workspace

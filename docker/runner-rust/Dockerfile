# rust:1-bookworm floats to the latest stable 1.x toolchain.
FROM rust:1-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash coreutils ca-certificates time gdb \
  && rm -rf /var/lib/apt/lists/*

COPY run-rust /usr/local/bin/run-rust
COPY debug-dap-rust /usr/local/bin/debug-dap-rust
RUN chmod +x /usr/local/bin/run-rust /usr/local/bin/debug-dap-rust

WORKDIR /workspace

# rust:1-bookworm floats to the latest stable 1.x toolchain.
FROM rust:1-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash coreutils ca-certificates time \
  && rm -rf /var/lib/apt/lists/*

COPY run-rust /usr/local/bin/run-rust
RUN chmod +x /usr/local/bin/run-rust

WORKDIR /workspace

FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    coreutils \
    gcc \
    g++ \
    gdb \
    gdbserver \
    time \
  && rm -rf /var/lib/apt/lists/*

COPY run-c /usr/local/bin/run-c
COPY run-cpp /usr/local/bin/run-cpp
COPY debug-c /usr/local/bin/debug-c
COPY debug-cpp /usr/local/bin/debug-cpp
COPY debug-dap-c /usr/local/bin/debug-dap-c
COPY debug-dap-cpp /usr/local/bin/debug-dap-cpp

RUN chmod +x /usr/local/bin/run-c /usr/local/bin/run-cpp /usr/local/bin/debug-c /usr/local/bin/debug-cpp /usr/local/bin/debug-dap-c /usr/local/bin/debug-dap-cpp

WORKDIR /workspace

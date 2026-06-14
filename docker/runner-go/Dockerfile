# golang:1-bookworm floats to the latest stable 1.x toolchain.
FROM golang:1-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash coreutils ca-certificates time socat \
  && rm -rf /var/lib/apt/lists/*

# Delve speaks DAP over TCP only; debug-dap-go bridges it to stdio with socat.
# Installed to /go/bin (on PATH) at build time when the network is available.
RUN go install github.com/go-delve/delve/cmd/dlv@latest

# Pre-warm a relocatable build cache so a cold sandbox container (fresh, network-off,
# 1 CPU, ~16s budget) compiles hello-world quickly. The entrypoint copies this into a
# writable cache under /workspace at runtime.
RUN mkdir -p /opt/gocache /tmp/warm \
  && printf 'package main\nimport "fmt"\nfunc main(){ fmt.Println("warm") }\n' > /tmp/warm/main.go \
  && cd /tmp/warm && go mod init warm \
  && GOCACHE=/opt/gocache GOPATH=/tmp/gopath go build -o /dev/null . \
  && rm -rf /tmp/warm /tmp/gopath

COPY run-go /usr/local/bin/run-go
COPY debug-dap-go /usr/local/bin/debug-dap-go
RUN chmod +x /usr/local/bin/run-go /usr/local/bin/debug-dap-go

WORKDIR /workspace

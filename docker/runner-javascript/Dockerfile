FROM node:22-bookworm-slim

ENV NODE_NO_WARNINGS=1

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash coreutils ca-certificates time \
  && rm -rf /var/lib/apt/lists/*

COPY run-javascript /usr/local/bin/run-javascript
COPY measure.cjs /usr/local/lib/measure.cjs
RUN chmod +x /usr/local/bin/run-javascript

WORKDIR /workspace

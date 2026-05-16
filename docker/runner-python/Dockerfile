FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash coreutils ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir \
  debugpy==1.8.20 \
  numpy==2.1.3 \
  pandas==2.2.3 \
  requests==2.32.3

COPY run-python /usr/local/bin/run-python
COPY debug-dap-python /usr/local/bin/debug-dap-python
RUN chmod +x /usr/local/bin/run-python /usr/local/bin/debug-dap-python

WORKDIR /workspace

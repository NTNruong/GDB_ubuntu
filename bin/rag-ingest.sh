#!/usr/bin/env bash
# Embed corpus-md/*.md (per corpus.manifest.json) and write the flat JSON index
# the api container reads. Runs the existing CLI: apps/api/src/rag/ingest.ts.
#
#   RAG_ROOT=/opt/gdb-rag GEMINI_API_KEY=AIza... bin/rag-ingest.sh
#   # or keep the key in a file:
#   RAG_ROOT=/opt/gdb-rag GEMINI_KEY_FILE=/opt/gdb-rag/gemini-key.txt bin/rag-ingest.sh
#
# The embedding model/dim MUST match the api container's RAG_EMBEDDING_MODEL /
# RAG_EMBED_DIM (defaults: gemini-embedding-001 / 768). Full runbook: docs/RAG.md
set -euo pipefail

RAG_ROOT="${RAG_ROOT:-/opt/gdb-rag}"
APP_DIR="${APP_DIR:-/opt/apps/GDB_ubuntu}"
MANIFEST="${MANIFEST:-$RAG_ROOT/corpus-md/corpus.manifest.json}"

if [ -z "${GEMINI_API_KEY:-}" ] && [ -n "${GEMINI_KEY_FILE:-}" ]; then
  GEMINI_API_KEY="$(cat "$GEMINI_KEY_FILE")"
fi
if [ -z "${GEMINI_API_KEY:-}" ]; then
  echo "GEMINI_API_KEY is required (or set GEMINI_KEY_FILE)." >&2
  exit 1
fi
if [ ! -f "$MANIFEST" ]; then
  echo "Manifest not found: $MANIFEST" >&2
  exit 1
fi

export RAG_DATA_ROOT="$RAG_ROOT/index"
export RAG_EMBEDDING_MODEL="${RAG_EMBEDDING_MODEL:-gemini-embedding-001}"
export RAG_EMBED_DIM="${RAG_EMBED_DIM:-768}"
export GEMINI_API_KEY

echo "Ingesting $MANIFEST -> $RAG_DATA_ROOT (model $RAG_EMBEDDING_MODEL, dim $RAG_EMBED_DIM)"
cd "$APP_DIR"
npm run -w @internal/api rag:ingest -- "$MANIFEST"

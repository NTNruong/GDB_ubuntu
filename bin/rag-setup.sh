#!/usr/bin/env bash
# One-time RAG host setup: create the /opt/gdb-rag layout and a Python venv with
# the PDF->Markdown converters (markitdown + docling). Run once per server.
#
#   sudo RAG_ROOT=/opt/gdb-rag bin/rag-setup.sh
#
# Full runbook: docs/RAG.md
set -euo pipefail

RAG_ROOT="${RAG_ROOT:-/opt/gdb-rag}"
PYTHON="${PYTHON:-python3}"

echo "RAG_ROOT = $RAG_ROOT"
mkdir -p "$RAG_ROOT/drop" "$RAG_ROOT/corpus-md" "$RAG_ROOT/index"

if [ ! -d "$RAG_ROOT/.venv" ]; then
  echo "Creating venv at $RAG_ROOT/.venv ..."
  "$PYTHON" -m venv "$RAG_ROOT/.venv"
fi

# shellcheck disable=SC1091
. "$RAG_ROOT/.venv/bin/activate"
python -m pip install --upgrade pip
# markitdown: clean prose/HTML/Office. docling: table-heavy vendor manuals
# (downloads its layout models on first run).
python -m pip install "markitdown[pdf]" docling

# Seed an empty manifest if none exists yet.
if [ ! -f "$RAG_ROOT/corpus-md/corpus.manifest.json" ]; then
  printf '{\n  "entries": []\n}\n' > "$RAG_ROOT/corpus-md/corpus.manifest.json"
  echo "Wrote empty $RAG_ROOT/corpus-md/corpus.manifest.json"
fi

cat <<EOF

Done. Next:
  1) bin/rag-fetch.sh            # download the pilot PDFs into drop/
  2) bin/rag-convert.sh          # PDF/HTML -> corpus-md/*.md, then edit the manifest
  3) bin/rag-ingest.sh           # embed + write index/index.json (needs GEMINI_API_KEY)
See docs/RAG.md for the manifest schema and the chat verification steps.
EOF

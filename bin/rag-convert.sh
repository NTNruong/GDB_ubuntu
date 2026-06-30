#!/usr/bin/env bash
# Convert a source (PDF in drop/, or an HTML URL) to Markdown in corpus-md/.
# Picks the converter: markitdown for prose/HTML, docling for table-heavy manuals.
#
#   # one-off:
#   RAG_ROOT=/opt/gdb-rag bin/rag-convert.sh markitdown drop/auburn-embedded-c.pdf auburn-embedded-c.md
#   RAG_ROOT=/opt/gdb-rag bin/rag-convert.sh docling    drop/stm32f4-rm0090.pdf    stm32f4-rm0090.md
#   RAG_ROOT=/opt/gdb-rag bin/rag-convert.sh markitdown https://docs.zephyrproject.org/latest/ zephyr.md
#
#   # convert the whole pilot set at once (uses the verified converter per source):
#   RAG_ROOT=/opt/gdb-rag bin/rag-convert.sh --pilot
#
# After converting, add each .md to corpus-md/corpus.manifest.json (schema in docs/RAG.md).
set -euo pipefail

RAG_ROOT="${RAG_ROOT:-/opt/gdb-rag}"
OUTDIR="$RAG_ROOT/corpus-md"
mkdir -p "$OUTDIR"

# shellcheck disable=SC1091
[ -f "$RAG_ROOT/.venv/bin/activate" ] && . "$RAG_ROOT/.venv/bin/activate"

convert_one() {
  tool="$1"; src="$2"; out="$3"
  dest="$OUTDIR/$out"
  echo "[$tool] $src -> $dest"
  case "$tool" in
    markitdown) markitdown "$src" > "$dest" ;;
    docling)    docling "$src" --to md --output "$dest" ;;
    *) echo "unknown converter: $tool (use markitdown|docling)" >&2; exit 2 ;;
  esac
}

if [ "${1:-}" = "--pilot" ]; then
  # table-heavy RM -> docling; everything else -> markitdown
  convert_one markitdown "https://arm-software.github.io/CMSIS_6/latest/Core/index.html" cmsis-core.md
  convert_one markitdown "https://docs.espressif.com/projects/esp-idf/en/latest/esp32/"  esp-idf.md
  convert_one markitdown "https://docs.zephyrproject.org/latest/"                        zephyr.md
  convert_one markitdown "$RAG_ROOT/drop/freertos-mastering.pdf"                         freertos-mastering.md
  convert_one docling    "$RAG_ROOT/drop/stm32f4-rm0090.pdf"                             stm32f4-rm0090.md
  convert_one markitdown "$RAG_ROOT/drop/auburn-embedded-c.pdf"                          auburn-embedded-c.md
  echo "Pilot conversion done -> $OUTDIR (now edit corpus.manifest.json)."
  exit 0
fi

if [ "$#" -ne 3 ]; then
  echo "usage: $0 <markitdown|docling> <src-file-or-url> <out.md>   (or: $0 --pilot)" >&2
  exit 2
fi
convert_one "$1" "$2" "$3"

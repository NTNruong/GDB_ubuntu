#!/usr/bin/env bash
# Download the pilot-corpus PDFs into $RAG_ROOT/drop (idempotent: skips files
# already present). The three HTML sources (CMSIS / ESP-IDF / Zephyr) are NOT
# downloaded here — convert them straight from their URL in bin/rag-convert.sh.
#
#   RAG_ROOT=/opt/gdb-rag bin/rag-fetch.sh
#
# These PDFs are free to download but COPYRIGHTED (private bucket) — keep them in
# drop/ only, never commit them. Full runbook: docs/RAG.md
set -euo pipefail

RAG_ROOT="${RAG_ROOT:-/opt/gdb-rag}"
DROP="$RAG_ROOT/drop"
mkdir -p "$DROP"

# name|url  (verified canonical sources)
PILOT_PDFS="
freertos-mastering.pdf|https://www.freertos.org/media/2018/161204_Mastering_the_FreeRTOS_Real_Time_Kernel-A_Hands-On_Tutorial_Guide.pdf
stm32f4-rm0090.pdf|https://www.st.com/resource/en/reference_manual/rm0090-stm32f405415-stm32f407417-stm32f427437-and-stm32f429439-advanced-armbased-32bit-mcus-stmicroelectronics.pdf
auburn-embedded-c.pdf|https://www.eng.auburn.edu/~nelson/courses/elec3040_3050/C%20programming%20for%20embedded%20system%20applications.pdf
"

echo "$PILOT_PDFS" | while IFS='|' read -r name url; do
  [ -z "$name" ] && continue
  dest="$DROP/$name"
  if [ -f "$dest" ]; then
    echo "skip  $name (already in drop/)"
  else
    echo "fetch $name"
    curl -fL --retry 3 -o "$dest" "$url"
  fi
done

cat <<EOF

PDFs in $DROP. HTML sources (convert by URL in bin/rag-convert.sh, no download needed):
  CMSIS-Core : https://arm-software.github.io/CMSIS_6/latest/Core/index.html   (public)
  ESP-IDF    : https://docs.espressif.com/projects/esp-idf/en/latest/esp32/    (public)
  Zephyr     : https://docs.zephyrproject.org/latest/                          (public)
EOF

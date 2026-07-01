# RAG Knowledge Base — Operator Runbook

How to fill and run the AI tutor's documentation retrieval (Phase A). You download
authoritative docs, convert them to Markdown, embed them into a flat JSON index on the
host, and the **api container reads that index** to ground chat answers (the **Docs**
toggle in the assistant panel). Embedded-first pilot corpus: CMSIS, ESP-IDF, Zephyr,
FreeRTOS, an STM32 reference manual, and the Auburn embedded-C tutorial.

The code is already shipped (`apps/api/src/rag/*`, the `rag:ingest` CLI, the `Docs`
toggle). This doc is the *operator* side: links, folders, conversion, ingest, verify.

## Data flow

```
host:  download PDFs / HTML  → /opt/gdb-rag/drop        (raw; copyrighted = never committed)
host:  markitdown / docling  → /opt/gdb-rag/corpus-md   (.md + corpus.manifest.json)
host:  bin/rag-ingest.sh     → /opt/gdb-rag/index/index.json   (embed each chunk via Gemini)
api :  bind /opt/gdb-rag/index → /rag-data (read-only); chat reads /rag-data/index.json
```

Ingestion runs **on the host** and writes the index; the **container only reads** it
(bind is `:ro`). The embedding **model + dimensions must match** on both sides — the
store rejects vectors built with a different model/dim. Pilot uses
`gemini-embedding-2` / `768` (multimodal, 3072-dim native, truncated to 768 via
Matryoshka to keep the index compact).

## Folder layout on the server (`/opt/gdb-rag/`)

Owned by the deploy/service user, **outside** the repo so copyrighted PDFs never sit
next to git and survive a repo re-clone.

| Dir | Holds |
|-----|-------|
| `drop/` | raw downloaded PDFs/HTML (incl. copyrighted vendor manuals) — local only |
| `corpus-md/` | converted `.md` + `corpus.manifest.json` — local only |
| `index/` | `index.json` (the embedded vector store) → bind-mounted into api as `/rag-data` |
| `.venv/` | Python venv with the converters (markitdown + docling) |

## One-time setup

```bash
sudo RAG_ROOT=/opt/gdb-rag bin/rag-setup.sh    # creates the dirs + venv, installs converters
```

Then wire the api container to read the index (deploy `.env` next to `docker-compose.yml`):

```ini
RAG_DATA_HOST_ROOT=/opt/gdb-rag/index
# optional — only if you change the model/dim from the defaults below:
# RAG_EMBEDDING_MODEL=gemini-embedding-2
# RAG_EMBED_DIM=768
```

`docker-compose.yml` already maps `RAG_DATA_HOST_ROOT → /rag-data:ro` and sets
`RAG_DATA_ROOT=/rag-data` inside the container. After the first ingest:
`docker compose up -d api` (env-only, no rebuild).

You also need a **Google AI Studio key** for embedding (the same key family as the
`gemini` chat backend). Keep it in a file, e.g. `/opt/gdb-rag/gemini-key.txt`.

## Pilot corpus — download links

Buckets: **public** = redistributable (Apache/MIT). **private** = free-to-download but
copyrighted → stays in `drop/`, personal/tailnet RAG only, **never committed**.

| # | Doc | Source | Convert | Bucket |
|---|-----|--------|---------|--------|
| 1 | CMSIS-Core | <https://arm-software.github.io/CMSIS_6/latest/Core/index.html> | markitdown (URL) | public (Apache-2.0) |
| 2 | ESP-IDF | <https://docs.espressif.com/projects/esp-idf/en/latest/esp32/> | markitdown (URL) | public (Apache-2.0) |
| 3 | Zephyr | <https://docs.zephyrproject.org/latest/> | markitdown (URL) | public (Apache-2.0) |
| 4 | FreeRTOS book | <https://www.freertos.org/media/2018/161204_Mastering_the_FreeRTOS_Real_Time_Kernel-A_Hands-On_Tutorial_Guide.pdf> | markitdown | private (© R. Barry) |
| 5 | STM32F4 RM0090 | <https://www.st.com/resource/en/reference_manual/rm0090-stm32f405415-stm32f407417-stm32f427437-and-stm32f429439-advanced-armbased-32bit-mcus-stmicroelectronics.pdf> | **docling** | private (© ST) |
| 6 | Auburn embedded-C | <https://www.eng.auburn.edu/~nelson/courses/elec3040_3050/C%20programming%20for%20embedded%20system%20applications.pdf> | markitdown | private (© V.P. Nelson) |

Download the three PDFs (#4–#6) into `drop/`:

```bash
RAG_ROOT=/opt/gdb-rag bin/rag-fetch.sh
```

## Convert to Markdown (markitdown vs Docling)

**Rule:** prose / HTML → **markitdown** (fast, zero-GPU). Register/peripheral tables in
vendor reference manuals → **Docling** (keeps multi-column table structure that
markitdown flattens). In the pilot only #5 (STM32 RM) needs Docling.

Convert the whole pilot set at once (correct converter per source):

```bash
RAG_ROOT=/opt/gdb-rag bin/rag-convert.sh --pilot
```

Or one-off:

```bash
# HTML by URL, or a PDF in drop/, into corpus-md/<out>.md
RAG_ROOT=/opt/gdb-rag bin/rag-convert.sh markitdown https://docs.zephyrproject.org/latest/ zephyr.md
RAG_ROOT=/opt/gdb-rag bin/rag-convert.sh docling    drop/stm32f4-rm0090.pdf               stm32f4-rm0090.md
```

Manual equivalents (if you skip the script):

```bash
. /opt/gdb-rag/.venv/bin/activate
markitdown drop/auburn-embedded-c.pdf > corpus-md/auburn-embedded-c.md
docling    drop/stm32f4-rm0090.pdf --to md --output corpus-md/stm32f4-rm0090.md
```

> Docling downloads its layout models on first run (slow once, then cached). Skim a
> converted RM to confirm register tables survived; if a table is mangled, that section
> just retrieves worse — re-run with Docling or trim the page range.

## Manifest

`corpus-md/corpus.manifest.json` lists what to embed. Schema (matches
`apps/api/src/rag/ingest.ts`):

```json
{
  "entries": [
    { "file": "cmsis-core.md",        "doc": "CMSIS-Core",        "sourceUrl": "https://arm-software.github.io/CMSIS_6/latest/Core/index.html", "bucket": "public" },
    { "file": "stm32f4-rm0090.md",    "doc": "STM32F4 RM0090",    "sourceUrl": "https://www.st.com/resource/en/reference_manual/rm0090-...pdf", "bucket": "private" },
    { "file": "auburn-embedded-c.md", "doc": "Auburn Embedded C", "sourceUrl": "https://www.eng.auburn.edu/~nelson/courses/elec3040_3050/...pdf", "bucket": "private" }
  ]
}
```

- `file` — path **relative to the manifest's dir** (`corpus-md/`).
- `doc` / `sourceUrl` — shown in the chat citations (`[n]` → clickable source).
- `bucket` — informational only (`public` / `private` / `restricted`).

## Ingest (embed → index)

```bash
RAG_ROOT=/opt/gdb-rag GEMINI_KEY_FILE=/opt/gdb-rag/gemini-key.txt bin/rag-ingest.sh
```

Prints `Indexed N chunks (model …, dim …) → /opt/gdb-rag/index/index.json`. Re-running
is an **upsert by id** (`<doc-slug>#<n>`), so re-ingest after editing the corpus; to
fully rebuild, delete `index/index.json` first.

**Rate limits (429 / "too many requests"):** the free `gemini-embedding-2` tier is
~100 requests/min (30K tokens/min, 1K/day). `bin/rag-ingest.sh` throttles with `RAG_INGEST_DELAY_MS` (default
`700`ms ≈ safe for the free tier), and the embedder **retries 429/503 with backoff**
(honoring Google's `Retry-After`), so a big corpus won't fail the whole job — it just
slows down. Lower `RAG_INGEST_DELAY_MS` on a paid tier for speed; raise it if you still
see backoff churn.

Then make the container see it:

```bash
docker compose up -d api      # picks up RAG_DATA_HOST_ROOT
```

## Use in chat (verify)

1. Log in, open the assistant panel, turn the **Docs** toggle **on**.
2. Ask a corpus question, e.g. *"NVIC priority grouping bits?"* or *"STM32F4 GPIO MODER
   register?"*.
3. The answer should cite a numbered **Source** under it (real `doc` + `sourceUrl`).
   No citation → see troubleshooting.

The Docs path is **best-effort**: if retrieval fails (no key, empty index), the chat
still answers, just without grounding — it never hard-fails the turn.

## Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| No citations, answer is generic | Docs toggle off; or no effective Gemini key (server `GEMINI_API_KEY` or a per-user key); or empty/missing index. |
| `Indexed 0 chunks` | Manifest `file` paths don't resolve, or the `.md` is empty (bad conversion). |
| Container answers but never cites | `RAG_DATA_HOST_ROOT` not pointing at `/opt/gdb-rag/index`, or container not restarted. |
| Store rejects vectors / dim error | `RAG_EMBEDDING_MODEL` / `RAG_EMBED_DIM` in the container differ from what ingest used. Keep both sides identical; to change model/dim, rebuild the index. |
| `429` / rate-limit during ingest | Free tier ~100 req/min. Raise `RAG_INGEST_DELAY_MS` (ingest already retries with backoff, so it recovers on its own — this just avoids the churn). |
| Huge/slow ingest after a Docling manual | Inline base64 images are dropped at chunk time, but a table-heavy manual is still many chunks; that's expected. |
| Garbled register tables | Converted with markitdown — re-convert that manual with Docling. |

## Licensing

- **public** (CMSIS, ESP-IDF, Zephyr, FreeRTOS kernel API) — redistributable.
- **private** (STM32 RM, Auburn PDF, the FreeRTOS *book*) — free to download but
  copyrighted; keep in `drop/`/`corpus-md/` on the server only, **never commit**. The
  `corpus/.gitignore` already blocks `*.md`, and the real corpus lives under `/opt`.
- **restricted** (e.g. MISRA) — only if you own it, never public.

## Beyond the pilot

Once retrieval quality is confirmed, drop more PDFs into `drop/`, convert, add manifest
entries, re-ingest (ARM Cortex-M TRMs, STM32 datasheets/HAL/PM, ESP32 TRM, ATmega, or the
language refs for C/C++/Python/Go/Rust/JS/Java). Later phases (local agent tool-loop;
local embedding on the RX570 with Qwen3-Embedding-0.6B) are tracked separately.

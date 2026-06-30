# RAG corpus

Source documents for the AI tutor's retrieval knowledge base (Phase A pilot).

> This in-repo `corpus/` is only the **template + sample** (`example-cmsis-nvic.md`
> + the manifest schema). The **real corpus lives off-repo** on the server at
> `/opt/gdb-rag/corpus-md` (so copyrighted vendor PDFs never touch git). Full
> operator runbook — download links, markitdown/Docling, ingest, the `/rag-data`
> bind, verification — is in [docs/RAG.md](../../../docs/RAG.md).

Manifest schema (matches [src/rag/ingest.ts](../src/rag/ingest.ts)):
`{ "entries": [ { "file": "name.md", "doc": "Label", "sourceUrl": "https://…", "bucket": "public" } ] }`

## Pipeline

1. **Convert to Markdown** (out of band — keeps the Node side dependency-light):
   - Clean HTML / prose PDFs / Office → use **markitdown** (fast, zero-GPU):
     `markitdown input.pdf > output.md`
   - Table-heavy vendor reference manuals (ARM/STM32/ESP register tables,
     multi-column) → use **Docling** (better table/layout fidelity):
     `docling input.pdf --to md --output output.md`
2. **Drop the `.md` here** and add an entry to [corpus.manifest.json](corpus.manifest.json):
   `{ "file": "name.md", "doc": "Label", "sourceUrl": "https://…", "bucket": "public" }`
   - `bucket`: `public` (redistributable, e.g. CMSIS/ESP-IDF Apache-2.0),
     `private` (free-but-copyrighted vendor PDF — personal/tailnet RAG only),
     `restricted` (paid, e.g. MISRA — only if owned).
3. **Ingest** (embeds + writes the index under `RAG_DATA_ROOT`):

   ```bash
   GEMINI_API_KEY=… RAG_DATA_ROOT=/path/to/rag-data \
     npm run -w @internal/api rag:ingest -- corpus/corpus.manifest.json
   ```

`example-cmsis-nvic.md` is a tiny sample so the pipeline can be verified
end-to-end before downloading the full manuals.

> Do **not** commit copyrighted vendor PDFs/markdown (`private`/`restricted`
> buckets) — keep those in a local drop folder outside the repo.

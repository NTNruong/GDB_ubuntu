import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ApiConfig } from "../config.js";
import { activeEmbedModelDim, indexFilePath, makeEmbedder } from "./embedderFactory.js";
import { GeminiEmbedder } from "./embedding.js";
import { LocalEmbedder } from "./localEmbedder.js";

function baseConfig(overrides: Partial<ApiConfig> = {}): ApiConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    runnerBaseUrl: "http://127.0.0.1:1",
    runnerWsUrl: "ws://127.0.0.1:1",
    userHomesRoot: "/tmp/x",
    usersFile: "/tmp/x/users.json",
    sessionSecret: "s",
    sessionCookieSecure: false,
    aiEnabled: true,
    llamaBaseUrl: "http://127.0.0.1:1",
    llamaApiKey: "",
    geminiApiKey: "",
    aiDataRoot: "/tmp/x/ai-data",
    aiKeySecret: "s",
    antigravityMaxMs: 180000,
    ragDataRoot: "/tmp/x/rag-data",
    ragEmbeddingModel: "gemini-embedding-2",
    ragEmbedDim: 768,
    ragEmbedRpm: 90,
    ragEmbedTpm: 27000,
    ragEmbedRpd: 900,
    ragEmbedBackend: "gemini",
    localEmbedBaseUrl: "http://host:8001",
    localEmbedModel: "qwen3-embedding-0.6b",
    localEmbedDim: 1024,
    localEmbedApiKey: "",
    ...overrides
  };
}

describe("makeEmbedder", () => {
  it("builds a LocalEmbedder when the backend is local", () => {
    const embedder = makeEmbedder(baseConfig({ ragEmbedBackend: "local" }), "");
    expect(embedder).toBeInstanceOf(LocalEmbedder);
  });

  it("builds a GeminiEmbedder when the backend is gemini and a key is given", () => {
    const embedder = makeEmbedder(baseConfig({ ragEmbedBackend: "gemini" }), "key");
    expect(embedder).toBeInstanceOf(GeminiEmbedder);
  });

  it("returns null for gemini with no key", () => {
    expect(makeEmbedder(baseConfig({ ragEmbedBackend: "gemini" }), "")).toBeNull();
  });
});

describe("activeEmbedModelDim", () => {
  it("reflects the gemini config when selected", () => {
    expect(activeEmbedModelDim(baseConfig())).toEqual({ model: "gemini-embedding-2", dim: 768 });
  });

  it("reflects the local config when selected", () => {
    expect(activeEmbedModelDim(baseConfig({ ragEmbedBackend: "local" }))).toEqual({
      model: "qwen3-embedding-0.6b",
      dim: 1024
    });
  });
});

describe("indexFilePath", () => {
  it("sanitizes a gemini model id into the index filename", () => {
    const config = baseConfig();
    expect(indexFilePath(config)).toBe(path.join("/tmp/x/rag-data", "index_gemini-embedding-2_768.json"));
  });

  it("sanitizes a local model id (dots) into the index filename", () => {
    const config = baseConfig({ ragEmbedBackend: "local" });
    expect(indexFilePath(config)).toBe(path.join("/tmp/x/rag-data", "index_qwen3-embedding-0-6b_1024.json"));
  });
});

import { describe, expect, it } from "vitest";
import type { AiThreadNode } from "@internal/shared";
import { modelSwitchPoints } from "./aiTree.js";

function node(id: string, role: "user" | "assistant", model?: string): AiThreadNode {
  return { id, parentId: null, role, content: id, at: 0, ...(model ? { model } : {}) };
}

describe("modelSwitchPoints", () => {
  it("flags an assistant node whose model differs from the previous assistant", () => {
    const path = [
      node("u1", "user"),
      node("a1", "assistant", "gemini-flash"),
      node("u2", "user"),
      node("a2", "assistant", "local-gemma-e4b")
    ];
    const map = modelSwitchPoints(path);
    expect(map.get("a2")).toBe("local-gemma-e4b");
    expect(map.has("a1")).toBe(false); // first model on the path never gets a divider
  });

  it("does not flag consecutive answers from the same model", () => {
    const path = [node("a1", "assistant", "m1"), node("a2", "assistant", "m1")];
    expect(modelSwitchPoints(path).size).toBe(0);
  });

  it("ignores assistant nodes without a model (e.g. a summary node)", () => {
    const path = [node("a1", "assistant", "m1"), node("s", "assistant"), node("a2", "assistant", "m1")];
    expect(modelSwitchPoints(path).size).toBe(0);
  });
});

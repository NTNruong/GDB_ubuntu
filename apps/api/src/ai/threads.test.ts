import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addNode, compactThread, createThread, pathToLeaf } from "./threads.js";

describe("compactThread", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "gdb-threads-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  /** Seed a linear thread of `turns` user+assistant pairs; returns its id. */
  async function seedLinear(turns: number): Promise<string> {
    const thread = await createThread(dir, "local-gemma-e4b", "t");
    let parent: string | null = null;
    for (let i = 0; i < turns; i++) {
      const user = await addNode(dir, thread.id, { parentId: parent, role: "user", content: `q${i}` });
      const asst = await addNode(dir, thread.id, {
        parentId: user.id,
        role: "assistant",
        content: `a${i}`,
        model: "local-gemma-e4b"
      });
      parent = asst.id;
    }
    return thread.id;
  }

  it("replaces older nodes with one summary node, keeping the recent tail", async () => {
    const id = await seedLinear(4); // 8 nodes
    const compacted = await compactThread(dir, id, "RECAP", 4);

    expect(compacted.nodes).toHaveLength(5); // summary + 4 kept
    const active = pathToLeaf(compacted, compacted.currentLeafId);
    expect(active).toHaveLength(5);
    expect(active[0]?.kind).toBe("summary");
    expect(active[0]?.parentId).toBeNull();
    expect(active[0]?.content).toBe("RECAP");
    expect(active.at(-1)?.content).toBe("a3"); // newest assistant survives
  });

  it("is a no-op when nothing is old enough to compact", async () => {
    const id = await seedLinear(1); // 2 nodes, keep=4
    const compacted = await compactThread(dir, id, "RECAP", 4);
    expect(compacted.nodes).toHaveLength(2);
    expect(compacted.nodes.some((node) => node.kind === "summary")).toBe(false);
  });

  it("discards off-branch variants outside the kept tail", async () => {
    const thread = await createThread(dir, "m", "t");
    const u1 = await addNode(dir, thread.id, { parentId: null, role: "user", content: "q1" });
    const a1 = await addNode(dir, thread.id, { parentId: u1.id, role: "assistant", content: "a1", model: "m" });
    // A sibling variant under the same user node (alternative answer).
    await addNode(dir, thread.id, { parentId: u1.id, role: "assistant", content: "a2", model: "m" });
    // Continue the conversation from a1 so the active path is 4 deep.
    const u2 = await addNode(dir, thread.id, { parentId: a1.id, role: "user", content: "q2" });
    await addNode(dir, thread.id, { parentId: u2.id, role: "assistant", content: "a3", model: "m" });

    const compacted = await compactThread(dir, thread.id, "RECAP", 2);
    expect(compacted.nodes).toHaveLength(3); // summary + [q2, a3]
    expect(compacted.nodes.some((node) => node.content === "a2")).toBe(false);
    expect(compacted.nodes.some((node) => node.content === "a1")).toBe(false);
  });
});

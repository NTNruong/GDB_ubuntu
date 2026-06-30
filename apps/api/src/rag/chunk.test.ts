import { describe, expect, it } from "vitest";
import { chunkMarkdown } from "./chunk.js";

describe("chunkMarkdown", () => {
  it("scopes chunks to their heading breadcrumb", () => {
    const md = [
      "# GPIO",
      "Intro to GPIO.",
      "## API Reference",
      "Use gpio_set_level().",
      "## Notes",
      "Pull-ups matter."
    ].join("\n");
    const chunks = chunkMarkdown(md);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toMatchObject({ headingPath: "GPIO", text: "Intro to GPIO." });
    expect(chunks[1]).toMatchObject({ headingPath: "GPIO > API Reference" });
    expect(chunks[2]).toMatchObject({ headingPath: "GPIO > Notes" });
  });

  it("pops sibling/deeper headings off the breadcrumb stack", () => {
    const md = ["# A", "## B", "text b", "# C", "text c"].join("\n");
    const chunks = chunkMarkdown(md);
    // "# A" has no body → no chunk; B is under A; C is top-level again.
    expect(chunks.map((chunk) => chunk.headingPath)).toEqual(["A > B", "C"]);
  });

  it("windows a long section with overlap, keeping the heading", () => {
    const para = "x".repeat(300);
    const body = Array.from({ length: 10 }, () => para).join("\n\n");
    const chunks = chunkMarkdown(`# Big\n${body}`, { maxChars: 800, overlap: 100 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.headingPath === "Big")).toBe(true);
    expect(chunks.every((chunk) => chunk.text.length <= 1000)).toBe(true);
  });

  it("ignores empty/whitespace sections", () => {
    expect(chunkMarkdown("# Empty\n\n   \n")).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { splitThinking } from "./aiContent.js";

describe("splitThinking", () => {
  it("returns the content unchanged when there is no think block", () => {
    expect(splitThinking("Just an answer")).toEqual({
      thinking: null,
      body: "Just an answer",
      thinkingOpen: false
    });
  });

  it("splits a closed think block from the answer body", () => {
    expect(splitThinking("<think>reason here</think>The answer")).toEqual({
      thinking: "reason here",
      body: "The answer",
      thinkingOpen: false
    });
  });

  it("treats an unclosed think block as still-thinking (streaming)", () => {
    expect(splitThinking("<think>reasoning in progress")).toEqual({
      thinking: "reasoning in progress",
      body: "",
      thinkingOpen: true
    });
  });

  it("trims surrounding whitespace and keeps text around the block", () => {
    expect(splitThinking("  <think> a </think>  b ")).toEqual({
      thinking: "a",
      body: "b",
      thinkingOpen: false
    });
  });
});

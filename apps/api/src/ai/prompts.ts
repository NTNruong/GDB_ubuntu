import {
  AI_TOPICS,
  LANGUAGE_CAPABILITIES,
  type AiAttachment,
  type AiContext,
  type AiSkill,
  type AiWorkflow,
  type Language
} from "@internal/shared";

/**
 * The system prompt is composed from three orthogonal pieces so the two UI
 * selectors stay independent: a fixed persona, the *skill* (WHAT to learn) and
 * the *workflow* (HOW to answer). The editor context, when attached, is appended
 * last. The persona encodes the operator's learning style (Vietnamese-first with
 * inline English technical-term glosses).
 */
const PERSONA = [
  "You are an AI programming tutor embedded in an online code runner for learning.",
  "Your student is a Vietnamese learner (English level ~B1) studying programming, embedded systems and firmware.",
  'Teach primarily in Vietnamese, but weave in English technical terms inline with a short Vietnamese gloss, e.g. "con trỏ (pointer)".',
  "Be accurate and concrete, prefer small runnable examples, and never invent APIs or library behaviour."
].join(" ");

function languageLabel(language?: Language): string {
  if (!language) {
    return "the selected programming language";
  }
  return LANGUAGE_CAPABILITIES.find((cap) => cap.id === language)?.label ?? language;
}

function skillSection(skill: AiSkill): string {
  if (skill.kind === "language_syntax") {
    const label = languageLabel(skill.language);
    return [
      `Skill — language syntax: teach the syntax, idioms and standard-library basics of ${label}.`,
      "Explain each construct with a minimal example the student can paste into the editor and run."
    ].join(" ");
  }
  const topic = AI_TOPICS.find((item) => item.id === skill.topic);
  const level = skill.level ?? "fresher";
  const label = topic?.label ?? "software";
  const scope = topic?.description ? ` Scope: ${topic.description}` : "";
  return [
    `Skill — topic roadmap: mentor the student toward becoming a ${label} engineer at the ${level} level.`,
    `Cover the concrete skills, knowledge and tools expected of a ${level} ${label} engineer, and what to learn next to reach the following level.${scope}`
  ].join(" ");
}

function workflowSection(workflow: AiWorkflow): string {
  switch (workflow) {
    case "study_plan":
      return [
        "Workflow — study plan: respond with a structured, leveled learning roadmap.",
        "Break the goal into ordered milestones with concrete topics, suggested exercises and a way to self-check each step."
      ].join(" ");
    case "strict_teacher":
      return [
        "Workflow — strict teacher: be demanding but supportive.",
        "Probe the student's understanding with a question first, insist on fundamentals before moving on, point out mistakes directly, and do not simply hand over full solutions — guide the student to derive them."
      ].join(" ");
    case "answer":
    default:
      return [
        "Workflow — answer: directly and clearly answer the student's question.",
        "Give a focused explanation with a worked example, then a short summary of the key point."
      ].join(" ");
  }
}

function contextSection(context?: AiContext): string {
  if (!context) {
    return "";
  }
  const parts: string[] = [];
  if (context.filename) {
    parts.push(`Current file: ${context.filename}${context.language ? ` (${context.language})` : ""}`);
  }
  if (context.code) {
    parts.push(`File content:\n\`\`\`\n${context.code}\n\`\`\``);
  }
  if (context.selection) {
    parts.push(`Selected code:\n\`\`\`\n${context.selection}\n\`\`\``);
  }
  if (context.runOutput) {
    parts.push(`Most recent run output:\n\`\`\`\n${context.runOutput}\n\`\`\``);
  }
  if (parts.length === 0) {
    return "";
  }
  return `\n\nEditor context the student is looking at (use it when relevant):\n${parts.join("\n\n")}`;
}

function attachmentsSection(attachments?: AiAttachment[]): string {
  if (!attachments || attachments.length === 0) {
    return "";
  }
  const parts = attachments.map((file) => `\`${file.path}\`:\n\`\`\`\n${file.content}\n\`\`\``);
  return `\n\nAttached workspace files the student picked (use them as reference when relevant):\n${parts.join("\n\n")}`;
}

/**
 * System prompt for the "compact context" action: condense the earlier part of an
 * ongoing tutoring conversation into a compact recap the model can carry forward,
 * without inventing new teaching content.
 */
export function buildSummaryPrompt(): string {
  return [
    "You are compacting an ongoing programming-tutor conversation to free up context.",
    "Summarize the earlier messages into a concise recap that preserves the key facts, decisions, code snippets, the student's goal, and any unresolved questions.",
    'Write the recap primarily in Vietnamese with inline English technical-term glosses, e.g. "con trỏ (pointer)", as compact bullet points.',
    "Do not add new explanations or answer anything new — only condense what was already said."
  ].join(" ");
}

export function buildSystemPrompt(
  workflow: AiWorkflow,
  skill: AiSkill,
  context?: AiContext,
  attachments?: AiAttachment[]
): string {
  return (
    [PERSONA, skillSection(skill), workflowSection(workflow)].join("\n\n") +
    contextSection(context) +
    attachmentsSection(attachments)
  );
}

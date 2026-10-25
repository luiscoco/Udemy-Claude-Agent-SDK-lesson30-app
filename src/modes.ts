import { resolve } from "node:path";
import { EXPERIMENTS, type Mode, type RunConfig } from "./protocol.js";
export const MODES = [...EXPERIMENTS];
export const SCENARIOS: Record<Mode, { stage: string; outcome: string }> = {
  approve: { stage: "Approve the actual Write once", outcome: "execute" },
  change: {
    stage: "Rewrite the output path and content before execution",
    outcome: "execute",
  },
  remember: {
    stage: "Apply a session permission update; inspect the next callback count",
    outcome: "observe",
  },
  "once-twice": {
    stage: "Approve each of two sequential writes separately",
    outcome: "execute",
  },
  reject: { stage: "Deny the pending Write with a reason", outcome: "block" },
  suggest: {
    stage: "Deny Write and guide the model to read the fixture",
    outcome: "mixed",
  },
  redirect: {
    stage: "Deny Write; send a distinct instruction on the same Query",
    outcome: "mixed",
  },
  preapproved: {
    stage: "An allow rule resolves Write before canUseTool",
    outcome: "execute",
  },
  cancel: { stage: "Cancel while the callback is waiting", outcome: "block" },
};
export function validateConfig(value: unknown): RunConfig {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !MODES.includes((value as RunConfig).mode)
  )
    throw new Error("Choose a listed approval experiment.");
  const c = value as RunConfig;
  if (
    c.prediction !== undefined &&
    !["execute", "block", "mixed", "observe"].includes(c.prediction)
  )
    throw new Error("Choose a listed prediction.");
  return { mode: c.mode, prediction: c.prediction };
}
export function hostAllows(
  cwd: string,
  name: string,
  input: Record<string, unknown>,
) {
  if (name === "Read")
    return (
      typeof input.file_path === "string" &&
      resolve(cwd, input.file_path) === resolve(cwd, "lesson.txt")
    );
  if (
    name !== "Write" ||
    typeof input.file_path !== "string" ||
    typeof input.content !== "string"
  )
    return false;
  const path = resolve(cwd, input.file_path);
  return (
    ["result.txt", "second.txt", "reviewed.txt"].some(
      (file) => path === resolve(cwd, file),
    ) && input.content.length <= 200
  );
}

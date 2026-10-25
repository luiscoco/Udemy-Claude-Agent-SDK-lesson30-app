import { runAgent, validateConfig } from "./agent.js";
import type { Choice } from "./protocol.js";
const config = validateConfig({ mode: process.argv[2] || "approve" });
const argument = process.argv.find((v) => v.startsWith("--decision="));
if (!argument)
  throw new Error(
    "Use the web app for review, npm run terminal for y/n, or explicitly supply --decision=approve (or another listed action) for a scripted demonstration.",
  );
const action = argument.split("=")[1] as Choice;
if (
  ![
    "approve",
    "change",
    "remember",
    "reject",
    "suggest",
    "redirect",
    "cancel",
  ].includes(action)
)
  throw new Error("Choose a listed decision.");
await runAgent(
  config,
  (e) => console.log(JSON.stringify(e)),
  new AbortController(),
  async () => ({ action, content: "REVIEWED-30\n" }),
);

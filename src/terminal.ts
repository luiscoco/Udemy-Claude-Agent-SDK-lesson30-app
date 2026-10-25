import { query } from "@anthropic-ai/claude-agent-sdk";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { resolve } from "node:path";
import { prepareWorkspace } from "./workspace.js";
import { MODEL } from "./agent.js";
const workspace = await prepareWorkspace(),
  controller = new AbortController();
const terminal = createInterface({ input: stdin, output: stdout });
const cancel = () => controller.abort();
process.once("SIGINT", cancel);
try {
  const run = query({
    prompt:
      "Use Write to create result.txt with APPROVAL-30 followed by one newline. Then request Bash with the command string exactly rm -- result.txt to delete that test file. The working directory is already configured: do not prepend cd, use an absolute path or change that command. Make sequential calls. Accept a denial without retry and report the actual result.",
    options: {
      model: MODEL,
      cwd: workspace.cwd,
      tools: ["Write", "Bash"],
      permissionMode: "default",
      settingSources: [],
      plugins: [],
      skills: [],
      mcpServers: {},
      strictMcpConfig: true,
      persistSession: false,
      maxTurns: 6,
      maxBudgetUsd: 0.3,
      abortController: controller,
      env: {
        ...process.env,
        HOME: workspace.home,
        USERPROFILE: workspace.home,
        CLAUDE_CONFIG_DIR: workspace.sdkHome,
      },
      hooks: {
        PreToolUse: [
          {
            hooks: [
              async (e) => {
                if (e.hook_event_name !== "PreToolUse") return {};
                const input = e.tool_input as Record<string, unknown>;
                console.log(
                  "Host scope check: " +
                    e.tool_name +
                    " " +
                    JSON.stringify(input),
                );
                const bounded =
                  e.tool_name === "Write"
                    ? typeof input.file_path === "string" &&
                      resolve(workspace.cwd, input.file_path) ===
                        resolve(workspace.cwd, "result.txt") &&
                      input.content === "APPROVAL-30\n"
                    : e.tool_name === "Bash" &&
                      input.command === "rm -- result.txt";
                return bounded
                  ? {
                      hookSpecificOutput: {
                        hookEventName: "PreToolUse",
                        permissionDecision: "ask",
                        permissionDecisionReason:
                          "This terminal exercise requires an explicit y/n decision.",
                      },
                    }
                  : {
                      hookSpecificOutput: {
                        hookEventName: "PreToolUse",
                        permissionDecision: "deny",
                        permissionDecisionReason:
                          "Only the disposable result.txt create/delete exercise is allowed.",
                      },
                    };
              },
            ],
          },
        ],
      },
      canUseTool: async (toolName, input, { signal }) => {
        console.log(
          "\nTool: " + toolName + "\n" + JSON.stringify(input, null, 2),
        );
        const answer = await terminal.question("Allow this action? (y/n): ", {
          signal,
        });
        return answer.trim().toLowerCase() === "y"
          ? { behavior: "allow", updatedInput: input }
          : {
              behavior: "deny",
              message: "User denied this action. Do not retry.",
            };
      },
    },
  });
  try {
    for await (const message of run)
      if (message.type === "result")
        console.log(
          message.subtype === "success"
            ? message.result
            : message.errors.join("\n"),
        );
  } finally {
    run.close();
  }
  console.log(
    "Independent file check: " + JSON.stringify(await workspace.inspect()),
  );
} finally {
  terminal.close();
  process.removeListener("SIGINT", cancel);
  await workspace.cleanup();
}

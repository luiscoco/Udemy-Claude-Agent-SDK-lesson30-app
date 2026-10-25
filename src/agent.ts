import {
  query,
  type Options,
  type PermissionUpdate,
  type PermissionResult,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { MODES, SCENARIOS, hostAllows, validateConfig } from "./modes.js";
import { prepareWorkspace } from "./workspace.js";
import { pendingCount, requestApproval } from "./approvals.js";
import type {
  Mode,
  RunConfig,
  LabEvent,
  Trace,
  Evidence,
  ApprovalRequest,
  Decision,
} from "./protocol.js";
export { MODES, validateConfig };
export const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";
export const DEFAULT_CONFIG: RunConfig = {
  mode: "approve",
  prediction: "execute",
};
const one =
  "Use Write once to create result.txt containing APPROVAL-30 followed by one newline. Wait for the actual tool result. If denied, never retry Write. If the reviewer suggests Read lesson.txt instead, perform that Read once and explain the marker. Otherwise briefly report the real outcome.";
export const PROMPTS = Object.fromEntries(
  MODES.map((mode) => [
    mode,
    mode === "remember" || mode === "once-twice"
      ? "Use Write to create result.txt with APPROVAL-30 followed by one newline. After that tool finishes, use Write to create second.txt with SECOND-30 followed by one newline. Make the calls sequentially, not in parallel. Do not read files or retry denied actions. Briefly report actual results."
      : one,
  ]),
) as Record<Mode, string>;
export function redact(text: string) {
  for (const secret of [
    process.env.ANTHROPIC_API_KEY,
    process.env.ANTHROPIC_AUTH_TOKEN,
  ].filter(Boolean) as string[])
    text = text.split(secret).join("[REDACTED]");
  return text.replace(/sk-ant-[A-Za-z0-9_-]+/g, "[REDACTED]").slice(0, 22000);
}
export function sessionSuggestions(
  suggestions: PermissionUpdate[],
  suppressed = false,
): PermissionUpdate[] {
  if (suppressed) return [];
  return suggestions
    .filter(
      (s) =>
        (s.type === "setMode" && s.mode === "acceptEdits") ||
        (s.type === "addRules" &&
          s.behavior === "allow" &&
          s.rules.length > 0 &&
          s.rules.every((r) => r.toolName === "Write")),
    )
    .map((s) => ({ ...s, destination: "session" as const }));
}
export async function runAgent(
  config: RunConfig,
  emit: (e: LabEvent) => void,
  controller = new AbortController(),
  provider?: (
    request: ApprovalRequest,
    signal: AbortSignal,
  ) => Promise<Decision>,
) {
  const c = validateConfig(config),
    s = SCENARIOS[c.mode],
    workspace = await prepareWorkspace();
  const trace: Trace[] = [],
    completed: string[] = [],
    reportedModes: string[] = [],
    resultStatuses: string[] = [],
    sessionIds: string[] = [];
  const decisions: Evidence["decisions"] = [],
    permissionUpdates: PermissionUpdate[] = [];
  let turn = 1,
    nativeErrors = 0,
    redirectRequested = false,
    redirectSent = false;
  const record = (entry: Trace) => {
    trace.push(entry);
    emit({ type: "trace", entry });
  };
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const redirectInstruction =
    "New task: read lesson.txt and explain its APPROVAL-30 marker in one short sentence. Do not create or modify any file.";
  async function* input(): AsyncGenerator<SDKUserMessage> {
    yield {
      type: "user",
      message: {
        role: "user",
        content:
          PROMPTS[c.mode] +
          `\nWorking directory: ${workspace.cwd}\nUse absolute paths inside this directory.`,
      },
      parent_tool_use_id: null,
      session_id: "",
    };
    await gate;
    if (redirectRequested && !controller.signal.aborted)
      yield {
        type: "user",
        message: { role: "user", content: redirectInstruction },
        parent_tool_use_id: null,
        session_id: "",
      };
  }
  const options: Options = {
    model: MODEL,
    cwd: workspace.cwd,
    permissionMode: "default",
    tools: ["Read", "Write"],
    allowedTools: c.mode === "preapproved" ? ["Read", "Write"] : ["Read"],
    settingSources: [],
    skills: [],
    plugins: [],
    mcpServers: {},
    strictMcpConfig: true,
    persistSession: false,
    maxTurns: 8,
    maxBudgetUsd: 0.4,
    effort: "low",
    thinking: { type: "disabled" },
    abortController: controller,
    env: {
      ...process.env,
      HOME: workspace.home,
      USERPROFILE: workspace.home,
      CLAUDE_CONFIG_DIR: workspace.sdkHome,
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
      ENABLE_CLAUDEAI_MCP_SERVERS: "false",
    },
    systemPrompt:
      "Perform real bounded classroom tool calls. Do not simulate results. Make only the requested Write calls. Read lesson.txt only if the reviewer suggests it or a later user task requests it. Accept a denial without retry; a suggestion to read is permitted. Do not use other tools or paths. Keep final responses short.",
    hooks: {
      PreToolUse: [
        {
          hooks: [
            async (event) => {
              if (event.hook_event_name !== "PreToolUse") return {};
              const pass = hostAllows(
                workspace.cwd,
                event.tool_name,
                event.tool_input as Record<string, unknown>,
              );
              record({
                phase: "hook",
                tool: event.tool_name,
                decision: pass ? "pass" : "deny",
                turn,
              });
              return pass
                ? {}
                : {
                    hookSpecificOutput: {
                      hookEventName: "PreToolUse",
                      permissionDecision: "deny",
                      permissionDecisionReason:
                        "Outside the bounded classroom files or content limit.",
                    },
                  };
            },
          ],
        },
      ],
      PostToolUse: [
        {
          hooks: [
            async (event) => {
              if (event.hook_event_name === "PostToolUse") {
                completed.push(event.tool_name);
                record({
                  phase: "post",
                  tool: event.tool_name,
                  decision: "completed",
                  turn,
                });
              }
              return {};
            },
          ],
        },
      ],
    },
    canUseTool: async (toolName, input, context) => {
      record({
        phase: "callback",
        tool: toolName,
        decision: "waiting for reviewer",
        turn,
      });
      const proposed = sessionSuggestions(
        context.suggestions || [],
        context.suppressAlwaysAllowRule,
      );
      const before = await workspace.inspect();
      const details = {
        toolName,
        input: JSON.parse(redact(JSON.stringify(input))),
        toolUseID: context.toolUseID,
        suggestions: context.suggestions || [],
        proposedPermissions: proposed,
        rememberAvailable: proposed.length > 0,
        fileBeforeApproval: before.fileCreated,
      };
      const signal = AbortSignal.any([context.signal, controller.signal]);
      let decision: Decision;
      if (provider) {
        const request = {
          id: randomUUID(),
          ...details,
          deadline: new Date(Date.now() + 120000).toISOString(),
        };
        emit({ type: "approval-request", ...request });
        decision = {
          ...(await provider(request, signal)),
          requestId: request.id,
        };
      } else decision = await requestApproval(details, emit, signal);
      decisions.push({
        action: decision.action,
        toolUseID: context.toolUseID,
        fileBeforeApproval: before.fileCreated,
      });
      let returned: PermissionResult;
      if (decision.action === "cancel" || signal.aborted) {
        controller.abort();
        returned = {
          behavior: "deny",
          message: "Reviewer cancelled. Stop without writing.",
        };
      } else if (decision.action === "change") {
        const updatedInput = {
          ...input,
          file_path: join(workspace.cwd, "reviewed.txt"),
          content: decision.content ?? "REVIEWED-30\n",
        };
        returned = hostAllows(workspace.cwd, toolName, updatedInput)
          ? { behavior: "allow", updatedInput }
          : {
              behavior: "deny",
              message: "Edited input is outside classroom bounds.",
            };
      } else if (decision.action === "remember" && proposed.length) {
        permissionUpdates.push(...proposed);
        returned = {
          behavior: "allow",
          updatedInput: input,
          updatedPermissions: proposed,
        };
      } else if (decision.action === "approve")
        returned = { behavior: "allow", updatedInput: input };
      else {
        redirectRequested = decision.action === "redirect";
        returned = {
          behavior: "deny",
          message:
            decision.action === "suggest"
              ? "Do not write. Instead, Read lesson.txt and explain the APPROVAL-30 marker briefly."
              : redirectRequested
                ? "Do not write. End this turn and await a separate user instruction."
                : "User rejected this action. Do not retry or create another file.",
        };
      }
      emit({
        type: "approval-resolved",
        id: decision.requestId || "",
        action: decision.action,
        returned,
      });
      return returned;
    },
  };
  emit({
    type: "configuration",
    files: [
      {
        name: "Actual approval policy",
        contents: JSON.stringify(
          {
            permissionMode: options.permissionMode,
            allowedTools: options.allowedTools,
            transport: "SSE approval-request; POST /api/approve",
            remember:
              "SDK-suggested acceptEdits or Write addRules, destination session; not persisted",
            approvalLifetimeSeconds: 120,
            callback:
              "Wait for an explicit decision; no automatic browser approval",
          },
          null,
          2,
        ),
      },
    ],
  });
  emit({
    type: "options",
    config: c,
    options: {
      model: MODEL,
      tools: options.tools,
      permissionMode: options.permissionMode,
      allowedTools: options.allowedTools,
      referenceStage: s.stage,
      expectedOutcome: s.outcome,
      cwd: "fresh disposable directory",
    },
  });
  let run: ReturnType<typeof query> | undefined;
  const warningListener = (warning: Error) => {
    const code = (warning as NodeJS.ErrnoException).code;
    if (code === "CLAUDE_SDK_CAN_USE_TOOL_SHADOWED")
      emit({
        type: "warning",
        code,
        explanation:
          "An earlier rule can resolve this tool before canUseTool. Inspect actual callback and completion counts.",
      });
  };
  process.on("warning", warningListener);
  const names = new Map<string, string>();
  try {
    const active = query({ prompt: input(), options });
    run = active;
    try {
      for await (const message of active) {
        emit({
          type: "message",
          sdkType: message.type,
          summary:
            "subtype" in message
              ? String(message.subtype)
              : "Actual SDK message",
        });
        if (message.type === "system" && message.subtype === "init") {
          reportedModes.push(message.permissionMode);
          emit({
            type: "initialized",
            model: message.model,
            sessionId: message.session_id,
            tools: message.tools,
            permissionMode: message.permissionMode,
          });
        }
        if (message.type === "assistant")
          for (const block of message.message.content) {
            if (block.type === "text")
              emit({ type: "answer", text: redact(block.text) });
            if (block.type === "tool_use") {
              names.set(block.id, block.name);
              emit({ type: "tool", name: block.name, args: block.input });
            }
          }
        if (message.type === "user" && Array.isArray(message.message.content))
          for (const block of message.message.content)
            if (block.type === "tool_result") {
              if (block.is_error) nativeErrors++;
              emit({
                type: "native-result",
                name: names.get(block.tool_use_id) || block.tool_use_id,
                isError: Boolean(block.is_error),
                content: JSON.parse(redact(JSON.stringify(block.content))),
              });
            }
        if (message.type === "result") {
          const status =
            message.subtype === "success"
              ? message.is_error
                ? "error"
                : "success"
              : message.subtype;
          const text = redact(
            message.subtype === "success"
              ? message.result
              : message.errors.join("\n"),
          );
          resultStatuses.push(status);
          sessionIds.push(message.session_id);
          emit({
            type: "result",
            status,
            text,
            costUsd: message.total_cost_usd,
          });
          if (redirectRequested && !redirectSent && status === "success") {
            redirectSent = true;
            turn = 2;
            emit({
              type: "redirect",
              instruction: redirectInstruction,
              sessionId: message.session_id,
            });
            release();
            continue;
          }
          break;
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) throw error;
    }
    if (controller.signal.aborted)
      emit({
        type: "result",
        status: "cancelled",
        text: "Cancelled while approval was pending. No approval was granted.",
        costUsd: null,
      });
    const files = await workspace.inspect();
    const observedOutcome = completed.length
      ? nativeErrors
        ? "mixed"
        : "execute"
      : "block";
    const evidence: Evidence = {
      mode: c.mode,
      prediction: c.prediction,
      predictedCorrect: c.prediction
        ? c.prediction === "observe" || c.prediction === observedOutcome
        : undefined,
      expectedStage: s.stage,
      expectedOutcome: s.outcome,
      observedOutcome,
      ...files,
      trace,
      completed,
      callbackCalls: trace.filter((t) => t.phase === "callback").length,
      nativeErrors,
      requestedMode: "default",
      reportedModes,
      resultStatuses,
      sessionIds,
      decisions,
      permissionUpdates,
      redirectSent,
      cancelled: controller.signal.aborted,
      pendingAfterRun: pendingCount(),
      reviewSource: provider
        ? "Explicit terminal/test decision provider"
        : "Actual browser approval buttons",
    };
    emit({ type: "evidence", ...evidence });
    return evidence;
  } finally {
    release();
    controller.abort();
    run?.close();
    process.removeListener("warning", warningListener);
    await workspace.cleanup();
  }
}

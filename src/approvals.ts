import { randomUUID } from "node:crypto";
import type { ApprovalRequest, Decision, LabEvent } from "./protocol.js";
interface Pending {
  settle: (decision: Decision) => void;
  rememberAvailable: boolean;
}
const pending = new Map<string, Pending>();
export function pendingCount() {
  return pending.size;
}
export function validateDecision(value: unknown): {
  id: string;
  decision: Decision;
} {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Provide an approval decision.");
  const v = value as Record<string, unknown>;
  if (
    typeof v.id !== "string" ||
    ![
      "approve",
      "change",
      "remember",
      "reject",
      "suggest",
      "redirect",
      "cancel",
    ].includes(String(v.action))
  )
    throw new Error("Provide an approval ID and listed action.");
  if (
    v.action === "change" &&
    (typeof v.content !== "string" || v.content.length > 200)
  )
    throw new Error("Edited content must be at most 200 characters.");
  return {
    id: v.id,
    decision: {
      action: v.action as Decision["action"],
      ...(v.action === "change" ? { content: v.content as string } : {}),
    },
  };
}
export function resolveApproval(id: string, decision: Decision) {
  const item = pending.get(id);
  if (!item || (decision.action === "remember" && !item.rememberAvailable))
    return false;
  item.settle(decision);
  return true;
}
export function requestApproval(
  details: Omit<ApprovalRequest, "id" | "deadline">,
  emit: (event: LabEvent) => void,
  signal: AbortSignal,
  timeoutMs = 120_000,
): Promise<Decision> {
  return new Promise((resolve) => {
    const id = randomUUID();
    let timer: ReturnType<typeof setTimeout>;
    const settle = (decision: Decision) => {
      if (!pending.delete(id)) return;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      resolve({ ...decision, requestId: id });
    };
    const abort = () => settle({ action: "cancel" });
    pending.set(id, { settle, rememberAvailable: details.rememberAvailable });
    timer = setTimeout(abort, timeoutMs);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    // Register the resolver before sending SSE, avoiding a fast-click race.
    emit({
      type: "approval-request",
      id,
      ...details,
      deadline: new Date(Date.now() + timeoutMs).toISOString(),
    });
  });
}

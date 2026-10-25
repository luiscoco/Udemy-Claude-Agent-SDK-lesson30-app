export const EXPERIMENTS = [
  "approve",
  "change",
  "remember",
  "once-twice",
  "reject",
  "suggest",
  "redirect",
  "preapproved",
  "cancel",
] as const;
export type Mode = (typeof EXPERIMENTS)[number];
export type Choice =
  | "approve"
  | "change"
  | "remember"
  | "reject"
  | "suggest"
  | "redirect"
  | "cancel";
export interface RunConfig {
  mode: Mode;
  prediction?: "execute" | "block" | "mixed" | "observe";
}
export interface ApprovalRequest {
  id: string;
  toolName: string;
  input: Record<string, unknown>;
  toolUseID: string;
  suggestions: unknown[];
  proposedPermissions: unknown[];
  rememberAvailable: boolean;
  deadline: string;
  fileBeforeApproval: boolean;
}
export interface Decision {
  requestId?: string;
  action: Choice;
  content?: string;
}
export interface Trace {
  phase: "hook" | "callback" | "post";
  tool: string;
  decision: string;
  turn: number;
}
export interface Evidence {
  mode: Mode;
  prediction?: string;
  predictedCorrect?: boolean;
  expectedStage: string;
  expectedOutcome: string;
  observedOutcome: string;
  fileCreated: boolean;
  fileContents: string | null;
  reviewedContents: string | null;
  secondContents: string | null;
  fixtureUnchanged: boolean;
  trace: Trace[];
  completed: string[];
  callbackCalls: number;
  nativeErrors: number;
  requestedMode: string;
  reportedModes: string[];
  resultStatuses: string[];
  sessionIds: string[];
  decisions: {
    action: Choice;
    toolUseID: string;
    fileBeforeApproval: boolean;
  }[];
  permissionUpdates: unknown[];
  redirectSent: boolean;
  cancelled: boolean;
  pendingAfterRun: number;
  reviewSource: string;
}
export type LabEvent =
  | { type: "options"; config: RunConfig; options: unknown }
  | { type: "configuration"; files: { name: string; contents: string }[] }
  | {
      type: "initialized";
      model: string;
      sessionId: string;
      tools: string[];
      permissionMode: string;
    }
  | { type: "trace"; entry: Trace }
  | ({ type: "approval-request" } & ApprovalRequest)
  | { type: "approval-resolved"; id: string; action: Choice; returned: unknown }
  | { type: "redirect"; instruction: string; sessionId: string }
  | { type: "message"; sdkType: string; summary: string }
  | { type: "tool"; name: string; args: unknown }
  | { type: "native-result"; name: string; isError: boolean; content: unknown }
  | { type: "warning"; code: string; explanation: string }
  | { type: "answer"; text: string }
  | { type: "result"; status: string; text: string; costUsd: number | null }
  | ({ type: "evidence" } & Evidence)
  | { type: "error" | "notice"; text: string };

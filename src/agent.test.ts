import test from "node:test";
import assert from "node:assert/strict";
import { hostAllows, validateConfig } from "./modes.js";
import {
  requestApproval,
  resolveApproval,
  pendingCount,
  validateDecision,
} from "./approvals.js";
import { sessionSuggestions } from "./agent.js";
import { prepareWorkspace } from "./workspace.js";
import type { ApprovalRequest, LabEvent } from "./protocol.js";
const details = {
  toolName: "Write",
  input: { file_path: "result.txt", content: "APPROVAL-30\n" },
  toolUseID: "test-tool",
  suggestions: [],
  proposedPermissions: [],
  rememberAvailable: false,
  fileBeforeApproval: false,
};
test("configuration and edited-input boundaries reject arbitrary modes and paths", () => {
  assert.throws(() => validateConfig({ mode: "bypassPermissions" }));
  assert.throws(() =>
    validateDecision({ id: "x", action: "change", content: "x".repeat(201) }),
  );
  assert.equal(
    hostAllows(process.cwd(), "Write", {
      file_path: "../result.txt",
      content: "x",
    }),
    false,
  );
  assert.equal(
    hostAllows(process.cwd(), "Write", {
      file_path: "reviewed.txt",
      content: "reviewed",
    }),
    true,
  );
});
test("a pending promise pauses until a single valid reviewer decision", async () => {
  let request: ApprovalRequest | undefined,
    settled = false;
  const p = requestApproval(
    details,
    (e: LabEvent) => {
      if (e.type === "approval-request") request = e;
    },
    new AbortController().signal,
  ).then((v) => {
    settled = true;
    return v;
  });
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(pendingCount(), 1);
  assert.equal(resolveApproval(request!.id, { action: "remember" }), false);
  assert.equal(resolveApproval(request!.id, { action: "approve" }), true);
  assert.equal(resolveApproval(request!.id, { action: "reject" }), false);
  assert.equal((await p).action, "approve");
  assert.equal(pendingCount(), 0);
});
test("abort and timeout resolve pending decisions and remove stale IDs", async () => {
  const controller = new AbortController();
  const p = requestApproval(details, () => {}, controller.signal);
  controller.abort();
  assert.equal((await p).action, "cancel");
  assert.equal(
    (await requestApproval(details, () => {}, new AbortController().signal, 5))
      .action,
    "cancel",
  );
  assert.equal(pendingCount(), 0);
});
test("remember uses actual Write suggestions in session scope and obeys suppression", () => {
  const updates = sessionSuggestions([
    {
      type: "addRules",
      rules: [{ toolName: "Write" }],
      behavior: "allow",
      destination: "localSettings",
    },
    { type: "setMode", mode: "bypassPermissions", destination: "session" },
  ]);
  assert.equal(updates.length, 1);
  assert.equal(
    sessionSuggestions([
      { type: "setMode", mode: "acceptEdits", destination: "session" },
    ]).length,
    1,
  );
  assert.equal(updates[0].destination, "session");
  assert.equal(sessionSuggestions(updates, true).length, 0);
  assert.equal(sessionSuggestions([]).length, 0);
});
test("each temporary workspace starts without outputs and cleans its own files", async () => {
  const w = await prepareWorkspace();
  try {
    const f = await w.inspect();
    assert.equal(f.fileCreated, false);
    assert.equal(f.secondContents, null);
    assert.equal(f.reviewedContents, null);
    assert.equal(f.fixtureUnchanged, true);
  } finally {
    await w.cleanup();
  }
});

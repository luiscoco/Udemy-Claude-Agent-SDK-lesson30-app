# Claude Agent SDK · Lesson 30 · Approvals in your UI

Five linked student pages, large text, actual SDK experiments and coloured code in all thirteen UML steps.

## What you will learn

- Pause a real tool request: canUseTool receives the actual tool name, input and callback context. The SDK waits on a promise while the browser shows the request. No approval is granted merely because the dialog is visible.
- Approve or edit before execution: Approve once returns the original input. Approve with changes rewrites the output to reviewed.txt and uses the student-edited content. Independent host checks show what the actual Write created.
- Remember within the current session: Inspect actual SDK suggestions and the proposed session-scoped updates. Remember returns eligible acceptEdits or Write rule updates through updatedPermissions. Compare two writes with one remembered approval against approving each write once.
- Reject, suggest or redirect: A rejection message reaches the model as tool feedback. A suggestion guides it to read the lesson instead. Redirect blocks the current write and sends a separate user instruction on the same live Query after the current turn ends.
- Build the browser approval round trip: The server streams SSE data frames to the browser; POST /api/approve resolves one pending request ID. The dialog displays tool-specific input, toolUseID, deadline and whether the output existed before review.
- Handle cancellation and earlier approval: Abort or timeout resolves and removes pending requests. Stale decisions cannot be replayed. Pre-approved Write calls never reach the callback. The terminal example uses the same y/n decision shape for a bounded create/delete exercise.

## Configure and run

```powershell
git clone https://github.com/luiscoco/Udemy-Claude-Agent-SDK-lesson30-app.git
cd .\Udemy-Claude-Agent-SDK-lesson30-app
npm ci
if (!(Test-Path .env)) { Copy-Item .env.example .env }
notepad .env
npm start
```

From presentations use `cd .\agent-sdk\lesson30-ui-approvals`. Open http://127.0.0.1:3130 and keep the terminal running. Node.js 24+, API credit and model access are required. Windows may require Git Bash.

## Create your .env file

Preserve an existing file. Enter your own model key, then restart. Existing shell values take precedence.

```dotenv
ANTHROPIC_API_KEY=your_api_key
CLAUDE_MODEL=claude-sonnet-4-6
PORT=3130
# Windows only, if needed:
# CLAUDE_CODE_GIT_BASH_PATH=C:/Program Files/Git/bin/bash.exe

```

No GitHub token or Managed Agents IDs are required. Secrets, dependencies and teaching media stay outside Git.

## Run the experiments

### Use the actual approval dialog

Choose Approve once and run. Inspect the requested Write and click Approve once. Repeat with Approve with changes, edit the content and inspect reviewed.txt in the independent evidence. For an explicitly scripted CLI demonstration:

```powershell
npm run sample:env -- approve --decision=approve
npm run sample:env -- change --decision=change
```

### Compare remember and refusal responses

Use Remember versus Approve once twice. Inspect actual callback counts, suggestions and session updates. Then try Reject, Suggest and Redirect using the corresponding buttons. Redirect uses the same Query for a separate task.

```powershell
npm run sample:env -- remember --decision=remember
npm run sample:env -- reject --decision=reject
npm run sample:env -- redirect --decision=redirect
```

### Practise terminal approvals and cancellation

Run the terminal example. Enter y to create the disposable test file, then n to deny deletion. The tool request is shown before each decision. Back in the web app compare Pre-approved Write with Cancel while pending.

```powershell
npm run terminal
# First request: y
# Delete request: n
npm test
```

## How the app was built

### 1. Validate the classroom task

The host accepts a fixed task name and prediction. Browser input cannot replace the SDK configuration or introduce arbitrary filesystem operations.

Source: `src/modes.ts`, selected lines 33–39. Surrounding code omitted.

```typescript
export function validateConfig(value: unknown): RunConfig {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !MODES.includes((value as RunConfig).mode)
  )
```

### 2. Create an isolated lab workspace

Create disposable project, home and SDK directories. The immutable fixture and output files are checked independently before bounded cleanup.

Source: `src/workspace.ts`, selected lines 13–19. Surrounding code omitted.

```typescript
const root = resolve(parent, randomUUID()),
    cwd = join(root, "project"),
    home = join(root, "home"),
    sdkHome = join(root, "sdk");
  const r = relative(parent, root);
  if (!r || r.startsWith("..") || isAbsolute(r))
    throw new Error("Invalid classroom workspace.");
```

### 3. Start a streaming SDK query

One query owns the real model/tool loop. The streaming input stays alive so a later redirect can send a distinct user instruction without starting a second session.

Source: `src/agent.ts`, selected lines 331–333. Surrounding code omitted.

```typescript
const active = query({ prompt: input(), options });
    run = active;
    try {
```

### 4. Receive a real permission callback

An unresolved tool request reaches canUseTool with its real input and context. Earlier allow rules can bypass this callback, as shown by the pre-approved comparison.

Source: `src/agent.ts`, selected lines 193–200. Surrounding code omitted.

```typescript
canUseTool: async (toolName, input, context) => {
      record({
        phase: "callback",
        tool: toolName,
        decision: "waiting for reviewer",
        turn,
      });
      const proposed = sessionSuggestions(
```

### 5. Register the pending resolver before SSE

Register the single-use resolver before emitting the request. This prevents a fast browser click from arriving before a pending entry exists.

Source: `src/approvals.ts`, selected lines 67–76. Surrounding code omitted.

```typescript
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
```

### 6. Send and render the SSE request

The browser receives the SSE data event and displays the actual tool, arguments, tool-use identifier, deadline and file state. Display alone does not approve execution.

Source: `src/client.ts`, selected lines 38–45. Surrounding code omitted.

```typescript
if (e.type === "approval-request") {
    approvalId = e.id;
    $("review-panel").hidden = false;
    json("approval-input", {
      toolName: e.toolName,
      input: e.input,
      toolUseID: e.toolUseID,
      fileBeforeApproval: e.fileBeforeApproval,
```

### 7. POST the reviewer decision

The browser posts an approval ID and action. Edited content has a bounded length; the server chooses the fixed reviewed output path.

Source: `src/client.ts`, selected lines 11–18. Surrounding code omitted.

```typescript
const response = await fetch("/api/approve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: approvalId,
      action,
      content: ($("edited-content") as HTMLTextAreaElement).value,
    }),
```

### 8. Resolve one pending approval

Reject missing or replayed IDs and unavailable remember choices. Settling removes the pending entry and cancels timeout and abort listeners.

Source: `src/approvals.ts`, selected lines 44–50. Surrounding code omitted.

```typescript
export function resolveApproval(id: string, decision: Decision) {
  const item = pending.get(id);
  if (!item || (decision.action === "remember" && !item.rememberAvailable))
    return false;
  item.settle(decision);
  return true;
}
```

### 9. Approve with validated changes

The host rewrites the Write path to reviewed.txt and inserts edited content. Validate the resulting request again before returning allow and updatedInput.

Source: `src/agent.ts`, selected lines 241–248. Surrounding code omitted.

```typescript
const updatedInput = {
          ...input,
          file_path: join(workspace.cwd, "reviewed.txt"),
          content: decision.content ?? "REVIEWED-30\n",
        };
        returned = hostAllows(workspace.cwd, toolName, updatedInput)
          ? { behavior: "allow", updatedInput }
          : {
```

### 10. Remember an SDK-derived session rule

Eligible actual SDK acceptEdits or Write addRules suggestions become session-scoped updates. Honour suppressAlwaysAllowRule. The host guard still bounds every tool, even after a permission update.

Source: `src/agent.ts`, selected lines 253–260. Surrounding code omitted.

```typescript
permissionUpdates.push(...proposed);
        returned = {
          behavior: "allow",
          updatedInput: input,
          updatedPermissions: proposed,
        };
      } else if (decision.action === "approve")
        returned = { behavior: "allow", updatedInput: input };
```

### 11. Reject or suggest an alternative

A deny result explains the refusal. Suggest includes read-only guidance, while redirect asks the model to end this turn and await a separate user instruction.

Source: `src/agent.ts`, selected lines 262–269. Surrounding code omitted.

```typescript
redirectRequested = decision.action === "redirect";
        returned = {
          behavior: "deny",
          message:
            decision.action === "suggest"
              ? "Do not write. Instead, Read lesson.txt and explain the APPROVAL-30 marker briefly."
              : redirectRequested
                ? "Do not write. End this turn and await a separate user instruction."
```

### 12. Send a distinct redirected task

After the first actual result, release a new input message on the same Query. Keep the two result/session identifiers to prove the continuity.

Source: `src/agent.ts`, selected lines 394–402. Surrounding code omitted.

```typescript
redirectSent = true;
            turn = 2;
            emit({
              type: "redirect",
              instruction: redirectInstruction,
              sessionId: message.session_id,
            });
            release();
            continue;
```

### 13. Verify outputs and clean pending state

Inspect result.txt, reviewed.txt, second.txt and the unchanged fixture. Compare actual callback counts, returned permissions, cancellation and pending-count evidence.

Source: `src/agent.ts`, selected lines 417–425. Surrounding code omitted.

```typescript
const files = await workspace.inspect();
    const observedOutcome = completed.length
      ? nativeErrors
        ? "mixed"
        : "execute"
      : "block";
    const evidence: Evidence = {
      mode: c.mode,
      prediction: c.prediction,
```

## Reference topics and limits

- Two SDK responses, six UI actions: The callback ultimately returns allow or deny. Editing and remembering enrich allow; suggestions enrich deny. Redirect is a separate streaming user message, not a third PermissionResult behavior.
- Actual suggestions and session scope: The app records the SDK suggestions and selects only acceptEdits or allow/addRules proposals for Write. Their destination is deliberately changed to session. This teaches remembered permissions without writing persistent settings. No suggestion is fabricated when the SDK supplies none.
- Suppressed remember control: If suppressAlwaysAllowRule is true, or no eligible Write suggestion exists, the UI disables remember and the server refuses it. The seven offline tests verify the unsupported-choice and suppression paths.
- Cancellation needs settlement: The slide removes an aborted request from its map. This implementation also resolves the pending promise as cancellation, clears its timer and removes its listener. Timeout and disconnected-browser aborts never grant approval.
- Local teaching scope: This loopback teaching server has one active run and same-origin POST checks. Random request IDs are single-use capabilities. A deployed multi-user product must bind requests to authenticated owners and provide its own authorization and durable lifecycle.
- A callback is not a universal hook: Read is pre-approved for the suggestion/redirect task. The pre-approved Write comparison demonstrates a real zero-callback run. A separate PreToolUse guard bounds all allowed paths and content sizes.
- Terminal create/delete exercise: The terminal app exposes only the disposable Write and the exact Bash command rm -- result.txt. A bounded PreToolUse ask decision routes both to y/n review. Answer y for creation and n for deletion. Host cleanup later removes only the verified temporary run directory.
- API usage and truthful evidence: The browser sends actual decisions to actual SDK calls. Nine experiments include a second model turn for redirect. The $0.40 SDK budget threshold is not a prepaid cap. Media, dependencies and credentials stay outside Git.

## References

- [Official SDK approvals documentation](https://code.claude.com/docs/en/agent-sdk/user-input)
- [TypeScript SDK reference](https://code.claude.com/docs/en/agent-sdk/typescript)

Regenerate student pages with `python scripts/build-pages.py`. Run `npm test` for offline boundaries, review lifecycle, workspace and startup checks.

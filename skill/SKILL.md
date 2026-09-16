---
name: orca-dag
description: "Use when planning an Orca task DAG, coordinating an interactive group board, turning an accepted specification into supervised implementation, or extending a delivery through review and progressive increments."
---

# Orca interactive group board

A board is the editable group workspace. Its Run node is the discussion/specification root; native Orca Runs are execution namespaces. A Task is work and a Dispatch is one immutable attempt. The chosen coordinator owns native execution and mailbox processing. The local server persists human edits and proposals, admits launches, and observes native outcomes. Human approval and native completion are separate facts.

## Enter the workflow

A fresh `$orca-dag` request can start in chat. Resolve the packaged CLI (`~/.orca/orca-dag` in utils; `dist-npm/bin/boardctl.mjs` in the installed package), then run:

```text
boardctl create --title "Delivery" --members '["SKILL","WORKER"]' --request "The human request" --action <stable-request-id>
boardctl resume --board <exact-board-id>
```

`create` reads one session inventory, includes the actual caller as coordinator, creates the same board the UI shows, and queues existing-session collection. Names select exact tab labels; duplicate labels return source-qualified identities for the human to choose. Reuse the action ID only for the same request. `resume --title <exact-title>` is allowed only for a unique match; otherwise use the ID. Resume verifies the caller's current coordinator/component-master/owner/member role and reads existing state; it does not create a Run or grant an additional group round. Read queued actions and continue the authorized request in that role.

For a board request, use the exact board ID, action ID, server URL, and `boardctl` path in the request. Run `boardctl --help`, then `read --board <id> --url <url>`. Commands run inside the selected coordinator session, whose source-qualified identity, terminal incarnation and host must match the board. When the tool shell does not inherit Orca identity, pass --terminal <your-own-handle>; native inventory still verifies its current source, incarnation and host. A nondefault runtime also needs --token-file <private-runtime/token-PORT>. Never select another session to impersonate it.

Ordinary human operation is through the web UI; agents use the packaged CLI. In utils the launcher is `node ~/.orca/orca-dag/start.mjs`, normally at `http://127.0.0.1:8787`. Other installations use their built entrypoint. Read `orca skills get orchestration` before native coordination, with the installed selected executable. Load conditional references for recovery, placement, or mailbox details only when needed.

Planning-only requests create documents under work-vault without starting workers. An existing accepted spec remains accepted; do not restart its interview. Existing native Runs remain available under Native run history, which is read-only.

## Process an action

1. Read the board and find the exact queued human action. Claim it once with `claim --action <id>`. Read the returned revision before publishing.
2. Produce the requested result below. Write proposals and evidence under the board's vault directory. Never edit `board.json` directly.
3. Publish using `publish --action <id> --base-revision <current> --file <proposal.json>`, or execute the claimed action with `execute-action --action <id>`. All commands also take `--board` and `--url`.
4. If a revision conflict occurs, read the current board, compare human edits with the retained proposal, and reconcile. Never overwrite the user's revision blindly.

| Action | Coordinator responsibility |
|---|---|
| collect-work | Read saved/native evidence, send each pending collection request once, publish your own summary, then synthesize available goals and scope. No group-init or Run rebinding. |
| discuss | Run `group-init`, follow the group skill's finite discussion rounds, collect attributed contributions, publish the canonical discussion and a spec proposal. |
| generate-tasks | Propose task nodes and dependencies from the approved Run root. Propose exact selected member identities or explicitly configured new workers. |
| review-graph | Review current graph/spec/results; propose expected examples or mockups, behavior and acceptance criteria. Run no implementation for Preview. |
| start / resume | Execute the action, then supervise ready tasks through `launch --node <id>`. |
| guidance | Execute; distinguish durable enqueue from acknowledgment and applied result. |
| stop-rerun | Execute, wait for stop evidence, execute again after a member attests, then launch only when the receipt marks rerunReady. |
| answer-question | Execute the exact native question reply. |
| members | Execute the approved selection through the shared group helper. Preserve existing sessions. |
| handover | The newly selected coordinator executes until all recorded Runs are rebound and the action is applied. |
| reconcile | Read its targetActionId, run `reconcile --action <target>`, inspect the outcome, then execute this request. |

`boardctl --help` contains complete JSON proposal examples. Spec proposals include attributed messages. Graph proposals include each node's prompt, plan, design, implementation notes, position and assignment, plus edges. Preview proposals carry the current specDigest and graphDigest from `read`. Optional Preview images are PNG/JPEG/WebP/GIF base64 objects with captions; each is bounded to 1 MB and the request to 2 MB. They are served as protected artifacts. Every task brief names target files/workspace, bounded change, constraints, ownership and observable acceptance.

## Existing sessions and ongoing work

New group selects exact existing sessions and a coordinator before creation; an empty group is still supported. Context collection reads bounded saved session notes and relevant canonical links, then observes native task ownership. Duplicate names are displayed with source-qualified session IDs. Shared workspaces do not establish ownership. Local discovery accepts a live footer or persisted Orca session metadata whose PTY, pane incarnation and agent source exactly match the live terminal; contradictory or unavailable bindings stay unavailable.

`collect --board <id>` refreshes saved/native context and requests fresh summaries. One outstanding request per member is retained across refresh/restart. As coordinator, read `collection.requests`, then run `collection-send --request <id>` for each pending other member. This sends a bounded native message at the next safe checkpoint. Publish your own request locally. Never launch a summary worker, call group-init, change the recipient's Run, or interrupt its work merely to collect context. Handle the collect-work action with the normal claim/publish flow; propose a specification from available responses and label missing context. Collection grants no specification approval.

A requested member runs `collection-publish --request <id> --file <summary.json>` from its own session. All commands include the exact board, URL and private token-file specified by the request. Summary JSON:

```json
{"goals":"Current goal","acceptedScope":"Existing approval and limits","blockers":"","documents":[],"items":[{"itemId":"stable-item-id","sourceIdentity":"codex:SESSION","ownerIdentity":"codex:SESSION","ownerHandle":"OWN_HANDLE","native":null,"title":"Current work","content":{"prompt":"Original scope","plan":"Current plan","design":"","implementationNotes":""},"status":"running","observedAt":"2026-09-16T00:00:00Z","references":[],"dependencies":[],"resultPath":null}]}
```

Use stable author-assigned item IDs for narrative work. Native items must match an already observed `native` value `{hostId,runId,taskId,dispatchId}`; no invented native IDs or changed owners/status. `result` may contain concrete completed narrative evidence, which is saved with author attribution; native completion comes from native observation. Multiple sources merge only for an identical native task identity. Similar descriptions remain separate until the human uses Match this report to existing work and confirms the exact duplicate. The target retains native ownership; the duplicate becomes historical. Source updates preserve human-edited fields and show conflicting proposals. Removed nodes, manual edges and positions remain respected. Late responses from previous deliveries or removed/rebound members stay historical.

For a stale owner action, `owner-reconcile --action <id> --evidence <text>` records the original owner investigation without replaying it; use it only after checking actual effects.

An uncertain send stays unknown. `collection-reconcile --request <id>` inspects its original native request receipt; it never silently sends a second prompt. The CLI saves the native send receipt before posting it back to the server; collection-reconcile can recover that receipt after a lost HTTP acknowledgment. If neither the request ID nor the saved receipt exists, investigate original native evidence before recovery. Enqueue is not acknowledgment, and no timer proves a safe checkpoint.

Imported tasks keep their original owner and Run. Include the actual controlling owner in the group before using controls. An owner processes `import-control` through `owner-claim --action <id>`, handles its frozen node revision and Task/Dispatch within its own session, then records `owner-finish --action <id> --stage acknowledged|applied --evidence <text>`. Acknowledged means read; applied means the requested control was actually handled, supported by native receipts or attributed cooperative evidence. Neither receipt alone settles the task.

Pause holds future board starts immediately and requests owner pause; admitted work may settle. The owner must check board requests before its future launches and report when its scheduler is paused. Resume preserves original approved scope; changed inputs require current Preview approval. Guidance targets the recorded Dispatch. Question answers use the original owner's mailbox and message ID. Stop/rerun settles existing work and child writers first, preserves sessions, and uses a new Task for changed inputs or native retry for unchanged failed inputs. Refresh collection after a replacement task is observed. Do not impersonate another owner or consume its inbox.

For imported work, `launch` is rejected. New board tasks can depend on a completed imported result; its immutable evidence is frozen into the new prompt without cross-Run native dependencies. The HTTP server never schedules imported work. Independent owner schedulers participate cooperatively; the board cannot enforce their native launches. Collaborate children retain the existing admission adapter.

## Discussion and approval

Use the existing group skill with the sessions explicitly selected on the board. `group-init` uses the configured helper and canonical discussion document; interrupted attachment recovers the existing group by document path. It never grants another round. Use explicit group continuation within the human's authorization when its allowance is exhausted.

Agreement comes from current contributions, never silence. Preserve dissent and unchecked changes. Finishing discussion does not approve the spec. The human approves the Run's current specification revision, edits generated tasks/dependencies/assignments, and requests Preview. Start accepts that exact Preview and authorizes execution in one action. Content changes invalidate Preview; moving nodes does not.

Before implementation, settle discussion assignments and preserve the selected sessions. Direct implementation normally uses a separate native Run while the visible board/Run root stays stable. When the coordinator also owns a component, refresh its binding first: direct tasks reuse that component Run without rebinding the master. Never use cross-Run native dependencies or discussion lifecycle IDs for implementation.

## Supervise execution

Use `launch --node <id>` for board-owned work. It freezes the node input and exact completed dependency attempts before native task creation and dispatch. New workers use their explicit workspace/model/effort. Existing members keep their process and identity. Self-assignment requires explicit coordinator handover.

The coordinator performs the native supervised loop: read every delivered message, answer questions, verify exact Task/Dispatch results, settle ownership, then acknowledge. Check the board's queued actions and pause scopes at each checkpoint; do not wait for terminal injection while already busy. UI questions are native ask/reply messages. The server only peeks at them.

Pause stops future admissions; admitted work can finish. An edit of an active task preserves original attempt inputs and holds downstream starts. Guidance is a separate recorded input. After a guided result completes, the human can inspect it and explicitly accept it for the edited revision, update Preview and Resume. Acceptance does not rewrite the original prompt or revision.

Stop an owned worker through its native lifecycle. For an existing member, request cooperative stop, wait for `attest-stop --attempt <id> --evidence <text>`, then fence the Dispatch. Do not interrupt/close its session. Revised inputs create a new native task. Unchanged failed inputs retry the original task using `--retry-of` and explicit placement; never bypass native failure accounting.

Unknown outcomes remain unknown. `reconcile` reads the original request ID: completed requests use their stored receipt; pending requests replay the exact operation with `--retry-request`. With no request ID, inspect exact native task/dispatch/resource evidence before recovery; absence proves nothing. Never repeat a launch blindly.

After accepted settlement, reuse, retain when requested, or release the worker. Release preserves pre-existing member sessions. Do not end with an owned reclaimable terminal or unread delivered messages. A stopped member attestation is evidence about writers; an enqueue receipt alone is not.

## Collaborate component nodes

A component is one task node with `assignment:null` and:

```json
{"collaborate":{"masterIdentity":"codex:SESSION","manifestPath":"/absolute/work-vault/sessions/collaborate/HOST/RUN/manifest.json"}}
```

The coordinator proposes this binding; the human can edit it in the task panel. `launch --node <id>` queues a component action to that master. Never dispatch the master as a parent worker or transfer its Run. Preserve its registered feature checkout and native mailbox. Direct tasks retain their own attempt lifecycle.

The component master uses the existing collaborate skill and these commands (all include `--board`, `--node`, `--url`):

1. `component-claim --action <id>`; inspect the saved node and request. Keep original worker briefs immutable.
2. Prepare the manifest and concrete gate, including `setup`, exact commands, baseline/overlay, human checks, selection preferences, repair policy, and feature-close scope. `component-refresh --action <id>` validates the master/feature/Run and registers admission. Finish the preparation action with `component-finish --action <id> --evidence <text>` so approval can wake continuation.
3. The human approves the displayed package, or the master uses `component-approve --digest <digest> --source-file <json> --action <id>` with the actual matching chat response. Source JSON is `{"kind":"chat","reference":"/path/to/user-answer.md","response":"exact answer"}`. An identical approval is reused; a changed package or node revision requires new approval. Board Start does not approve an unseen component gate.
4. Use the installed restricted `launch.py worker` for every implementation, review, repair and clean-context worker. Admission is discovered from the bound Task/Run. It checks pause/revisions before resource preparation and again immediately before worker-start. An unavailable board blocks new starts, while native settlement remains available. A paused prepared journal resumes with the same profile/terminal; an unknown Dispatch is reconciled using its original receipt/request. Repeating the identical journal inspects a saved native request ID; only a completed receipt is recovered, and pending or unverifiable requests remain blocked. A completed journal with `board_record_error` retries receipt persistence only.
5. During supervision, read component guidance/stop/question/reconciliation actions at every checkpoint. Claim each, act through the owning master and exact child Dispatch/message, and finish with receipt-backed evidence. Stop children without closing the master. A saved edit holds downstream starts; rerun needs the updated Preview/node and gate approvals. Completing an action acknowledges handling only; it never settles native workers.
6. Archive reports into the manifest run directory. Publish `component-result --action <id> --file <json>` using `{"nodeRevision":1,"selectionPath":"/run/outcome/slice.json","candidateStatePath":"/bulk/candidates/impl-opus/state.json","gateResultPath":"/bulk/candidates/impl-opus/gate-result.json"}`. The server validates selection, current applied aggregate gate, opposite-family review and adjudication, preserving original Task/Dispatch IDs. Settle/reconcile all children first, then finish the component-start action. Report integration acceptance through a dependent task/component with its own concrete evidence.

Expanded details show candidate/review/repair Tasks, frozen saved briefs and reports, exact gate approval, launch recovery references and selected result. Each downstream launch freezes predecessor result digests; cross-component Task IDs never become native dependencies. Pause blocks later child launches, including reviews/repairs. Apply and new increments remain blocked by unresolved component work. Earlier delivery snapshots retain their evidence.

The local API trusts the local coordinator's recorded approval provenance; it is not cryptographic proof of a human click. Host-level masters can invoke native tools outside this cooperative protocol, so do not claim sandbox enforcement on masters.

## Implementation edits and increments

The Implementation panel can read actual task-workspace files and preview unified diffs. Saving a draft only stores it in the vault. Apply explicitly writes after base-digest and path checks. An active writer blocks Apply; send the patch as guidance or stop the writer first. Resolve conflicts against current file contents. Do not treat Implementation notes as applied code. Applying saved implementation files advances the task revision and invalidates its accepted result and Preview before writing. Downstream starts pause; review the resulting files and update Preview before restarting. Saving a draft alone leaves execution unchanged.

For contract repairs, preserve the accepted contract and add related work. For changed behavior, amend the affected spec and obtain approval for the changed revision. New increment archives the current delivery and keeps the group's Run/spec/membership. It cannot discard active or unknown work. Earlier native tasks, attempts and results remain immutable history.

Finish with actual outcomes, tested evidence, unresolved choices and each worker's ownership disposition. Keep artifacts in work-vault. Report actual token usage only when available; never infer savings from elapsed time.

Questions answered through the board retain owner receipts. Native read-only mailbox inspection does not expose external answer state; settled tasks disable further replies and retain the question as history without claiming an observed answer.

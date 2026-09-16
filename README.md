# Orca DAG — personal workflow fork

An editable group board with native Orca task history and a workflow skill for **group-authored spec → supervised implementation → progressive increments**.

This MIT-licensed fork derives from [ZinkLu/Orca-Orchestration](https://github.com/ZinkLu/Orca-Orchestration). The personal source is [marshyunlee/Orca-Orchestration](https://github.com/marshyunlee/Orca-Orchestration), pinned as the `utils/orca/orca-dag` submodule. Upstream npm releases do not contain these customizations.

## Workflow

1. Create a group tab: its editable Run root appears immediately. Select existing sessions and a coordinator directly in New group, or leave it empty. Manage sessions adds members later.
2. Enter a request and choose Discuss with group. The coordinator runs bounded group rounds and publishes attributed contributions and the specification. Approve spec when satisfied.
3. Generate tasks. Edit prompts, plans, designs and assignments in the inspector. Drag nodes, connect handles, and select nodes or edges to delete them.
4. Request Review graph / Update preview. The coordinator describes expected output, examples and acceptance criteria without executing implementation. Start accepts the current Preview and begins supervised work.
5. Intervene through Pause, guidance, Stop and rerun, or native question replies. Running-task edits hold downstream starts. Review guided results explicitly before accepting them for a changed revision and resuming.
6. Use New increment after settlement to archive the delivery and retain the group/Run/spec root for subsequent work.

The selected coordinator performs native operations through packaged `boardctl`; the local server persists edits, admits launches and observes outcomes. Existing members retain their session identity. Unknown effects remain visible for reconciliation. Native task and attempt evidence is never rewritten to match a board edit.

The Implementation panel opens actual workspace files, accepts edited text or unified diffs, and separates Save file draft from Apply. Apply checks base digests and path containment and refuses an active writer. Conflict comparison preserves the user's draft. Preview renders text and bounded PNG/JPEG/WebP/GIF mockups from protected board artifacts; agent HTML is not executed.

## Build and start

Requires a running Orca with the Run/Task/Dispatch API and Node.js 20 or newer. Load the installed `orca skills get orchestration` guide before coordinating work; it is authoritative for the installed version.

```sh
npm ci --registry=https://registry.npmjs.org --ignore-scripts
npm run build:npm
ORCA_DAG_NO_SKILL=1 NO_OPEN=1 node dist-npm/bin/orca-dag.mjs
```

Open `http://127.0.0.1:8787` in Orca's embedded browser. The server listens on loopback. `PORT` selects another port. `WORKSPACE_DIR` selects the directory containing `.orca-dag.config.json`; it does not select worker placement. `NO_OPEN=1` skips opening a browser. `ORCA_DAG_NO_SKILL=1` or `--no-skill` disables the bundled skill installer.

In the utils installation, use `node ~/.orca/orca-dag/start.mjs`. Claude and Codex use the identical skill mirrored into utils SSOT; preserve those deployment symlinks. Restarting the viewer after a rebuild is sufficient; Orca itself does not need restarting.

The utils launcher supplies `ORCA_GROUP_HELPER` (shared group Python helper), `ORCA_WORK_CONTEXT_HELPER` (the existing Orca session resolver), and `ORCA_BOARD_ROOT` (default `~/work-vault/sessions/orca-boards`). Standalone installs must configure the two helpers to discover sessions and run group discussion. Unknown identities remain unavailable; labels are never treated as unique IDs.

Board snapshots, revisions and artifacts survive restarts. Private API tokens live in `~/.local/state/orca-board`, outside synchronized work-vault. One live writer is allowed per board store. `ORCA_CLI_COMMAND` selects the native executable consistently. Development may set `ORCA_BOARD_DEV_ORIGIN` to the exact Vite origin.

## Viewing history

- Pick a native Run. Group/design and implementation Runs appear separately.
- Click nodes to inspect specs, results, and observed attempt IDs. The viewer does not guess agent/model provenance from preferences.
- **Show completed tasks** is on by default. Turn it off to hide unrelated completed history. Completed ancestors of active work and tasks needed for unresolved decisions remain visible. Counts describe the whole Run, with a separate hidden count.
- Gates show their native question, options, status, and resolution. Respond in the coordinator conversation.
- A failed refresh leaves the last successful snapshot visible with an explicit stale-data notice. Switching Runs clears old selection and rejects late responses from the previous Run.
- A completed task means that native task settled; it does not imply the user accepted the delivery.

Layout and selected Run are persisted. Historic harness/model/concurrency preferences are retained as user data but have no execution or attribution effect. The history toggle is local to the page and resets on reload.

## API

| Method | Path | Result |
|---|---|---|
| GET | `/api/health` | Viewer availability and preference directory |
| GET | `/api/runs` | Native Runs |
| GET | `/api/dag?run=<id>` | Native task graph and gates |
| GET | `/api/config` | Saved viewer preferences |
| PUT | `/api/config` | Merge preference changes |

Interactive boards use `/api/boards` and revision-checked `/api/boards/:id/edit` actions. Private artifact, workspace, integration and session endpoints require the local token. Mutations require both the token and an allowed local origin. `boardctl` uses the same protected API; it is packaged at `dist-npm/bin/boardctl.mjs`.

Legacy native routes remain read-only. Unsupported endpoints return 404 before the SPA fallback. No endpoint executes arbitrary browser-supplied shell commands.

## Development and verification

```sh
npm test
./node_modules/.bin/tsc -p server/tsconfig.json --noEmit
npm run build:npm
node scripts/check-skill.mjs
```

Tests use Node's runner and the existing tsx dependency. `npm run build:npm` includes the frontend typecheck/build and stages a self-contained server/SPA package. `npm run dev` starts Vite and the API. Optional `npm run build:binary` requires Bun; its generated assets must not be edited or committed.

- `server/src/app.ts`: board and history HTTP routes, isolated from startup.
- `server/src/index.ts`: CLI startup, loopback listening, static/embedded assets.
- `server/src/orca.ts`: typed native coordinator transport and read projections.
- `server/src/config.ts`: preferences and preserved historic keys.
- `web/src/viewConfig.ts`: reactive layout/Run preferences.
- `web/src/graphVisibility.ts`: active work plus original dependency context.
- `skill/SKILL.md`: self-contained agent workflow, packaged with the app.

`orca-dag uninstall --dry-run` previews removal; `--purge` also removes the selected preference file. Uninstall preserves repository contents behind directory symlinks and can clean coordinator terminals left by older versions. Do not invoke it during observation or worker cleanup. Skill installation and uninstallation remain symmetric.

Changes are pushed to the personal fork before advancing the utils submodule pointer and identical deployed skill mirror. Preserve the MIT copyright notice. Publishing an npm package or a release tag is outside the personal installation workflow.

## Collaborate component integration

Start or resume the same UI board from chat with the packaged `boardctl create` / `resume` commands. Component tasks use one expandable node. Select the component master and its collaborate manifest in the task panel; the master retains its registered feature workspace and native Run.

The panel displays the exact gate package, implementation/review/repair history, saved briefs/reports, launch journals and selected-result evidence. Approve each concrete gate once in chat or UI. Gate or scope changes invalidate that approval. Guidance, stop preparation and question answers route to the component master. Pause blocks future restricted child launches, including reviews and repairs. Unknown receipts require reconciliation, never blind retries.

The utils launcher also supplies `ORCA_FEATURE_WORKTREE_HELPER` and `ORCA_COLLABORATE_LEDGER_HELPER`. Standalone installations configure these existing collaborate/worktree helpers for component support. `ORCA_COLLABORATE_ROOT`, `ORCA_COLLABORATE_BULK_ROOT`, and `ORCA_BOARD_RUNTIME` can isolate fixture directories. Private tokens stay outside work-vault. See the packaged skill and `boardctl --help` for exact JSON examples and recovery commands.

New human steps for component execution: select a master/manifest, approve its concrete gate when presented, and review changed gates before continuing. Direct task controls retain their existing workflow.

## Existing-session onboarding

New group can select existing Orca sessions and a coordinator before creation. The Run root appears immediately. Saved context and known native tasks are collected first; the coordinator requests fresh agent summaries at safe checkpoints. Duplicate tab names retain exact source-qualified identities. Missing or unavailable context remains visible.

Imported tasks retain their original Run, Task, Dispatch and execution owner. Their panel shows source evidence, observed status, conflicting source proposals and owner controls. Include an external controlling owner through Manage sessions to enable controls. Pause, guidance, resume, stop/rerun and answers route through that owner; acknowledgment and applied outcome are displayed separately. Independent schedulers cooperate with these requests; the dashboard does not claim to forcibly pause them. New board work still requires spec/Preview approval, and Start never duplicates imported work.

Context and receipts persist with the board under `~/work-vault/sessions/orca-boards`. `ORCA_WORK_VAULT` optionally selects the saved-context vault. `boardctl --help` documents `collect`, `collection-send`, `collection-publish`, `collection-reconcile`, `owner-claim`, `owner-finish` and `owner-reconcile`. Collection creates no new native Run or summary Dispatch. Human edits, positions and removed source edges survive refresh.

Human steps: select sessions/coordinator, review overlapping source edits, and include the task's actual owner if it is outside the group. The server remains headless.

Questions answered through the board retain owner receipts. Native read-only mailbox inspection does not expose external answer state; settled tasks disable further replies and retain the question as history without claiming an observed answer.

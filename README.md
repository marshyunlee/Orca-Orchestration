# Orca DAG — personal workflow fork

An observer for native Orca task history, paired with a workflow skill for **group-authored spec → supervised implementation → progressive increments**.

This MIT-licensed fork derives from [ZinkLu/Orca-Orchestration](https://github.com/ZinkLu/Orca-Orchestration). The personal source is [marshyunlee/Orca-Orchestration](https://github.com/marshyunlee/Orca-Orchestration), pinned as the `utils/orca/orca-dag` submodule. Upstream npm releases do not contain these customizations.

## Workflow

1. Discuss one bounded delivery with your coordinator, optionally using `group` with explicitly selected existing sessions. The group maintains one specification document in work-vault.
2. Accept the reviewed document. The coordinator freezes its exact bytes and records the accepted digest and decision reference. Agent consensus alone does not authorize implementation.
3. Once authorized, the coordinator creates an implementation Run and tasks. Group discussion has its own Run; the implementation briefs reference its accepted spec. The design interview is not repeated.
4. Observe native task statuses, dependencies, specs, results, and current dispatch/terminal IDs here. Send decisions and start/stop requests through your coordinator conversation.
5. Iterate: repair contract violations, amend the affected spec for changed behavior, and give substantial new deliveries separate Runs. Preserve earlier results as history.

The viewer never acquires a coordinator binding, consumes its mailbox, or executes workers. It has no Run creation, execution, gate-resolution, model-selection, or reset controls. Existing native coordination and selected review skills own their lifecycle rules.

## Build and start

Requires a running Orca with the Run/Task/Dispatch API and Node.js 20 or newer. Load the installed `orca skills get orchestration` guide before coordinating work; it is authoritative for the installed version.

```sh
npm ci --registry=https://registry.npmjs.org --ignore-scripts
npm run build:npm
ORCA_DAG_NO_SKILL=1 NO_OPEN=1 node dist-npm/bin/orca-dag.mjs
```

Open `http://127.0.0.1:8787` in Orca's embedded browser. The server listens on loopback. `PORT` selects another port. `WORKSPACE_DIR` selects the directory containing `.orca-dag.config.json`; it does not select worker placement. `NO_OPEN=1` skips opening a browser. `ORCA_DAG_NO_SKILL=1` or `--no-skill` disables the bundled skill installer.

In the utils installation, use `node ~/.orca/orca-dag/start.mjs`. Claude and Codex use the identical skill mirrored into utils SSOT; preserve those deployment symlinks. Restarting the viewer after a rebuild is sufficient; Orca itself does not need restarting.

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

All removed execution/mutation endpoints return 404. Neither configuration nor graph viewing can mutate orchestration. There is no local-file serving endpoint for work-vault documents.

## Development and verification

```sh
npm test
./node_modules/.bin/tsc -p server/tsconfig.json --noEmit
npm run build:npm
node scripts/check-skill.mjs
```

Tests use Node's runner and the existing tsx dependency. `npm run build:npm` includes the frontend typecheck/build and stages a self-contained server/SPA package. `npm run dev` starts Vite and the API. Optional `npm run build:binary` requires Bun; its generated assets must not be edited or committed.

- `server/src/app.ts`: observer HTTP routes, isolated from startup.
- `server/src/index.ts`: CLI startup, loopback listening, static/embedded assets.
- `server/src/orca.ts`: native read adapter and separately invoked uninstall cleanup.
- `server/src/config.ts`: preferences and preserved historic keys.
- `web/src/viewConfig.ts`: reactive layout/Run preferences.
- `web/src/graphVisibility.ts`: active work plus original dependency context.
- `skill/SKILL.md`: self-contained agent workflow, packaged with the app.

`orca-dag uninstall --dry-run` previews removal; `--purge` also removes the selected preference file. Uninstall preserves repository contents behind directory symlinks and can clean coordinator terminals left by older versions. Do not invoke it during observation or worker cleanup. Skill installation and uninstallation remain symmetric.

Changes are pushed to the personal fork before advancing the utils submodule pointer and identical deployed skill mirror. Preserve the MIT copyright notice. Publishing an npm package or a release tag is outside the personal installation workflow.

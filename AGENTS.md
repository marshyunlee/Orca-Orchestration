# Agent instructions

Edit this file directly; CLAUDE.md remains its symlink.

## Architecture and authority

This personal fork contains a self-contained workflow skill and an interactive group board built with Express, React, React Flow, and TypeScript. Read server/src/orca.ts before changing native integration. The conversational coordinator owns execution and mailbox processing. The server reads explicit Run IDs and queues authenticated human actions. Only boardctl inside the selected existing coordinator performs native mutations. The server must not acquire coordinator authority or consume messages. Legacy native history remains read-only.

server/src/app.ts owns the HTTP routes. index.ts owns startup and disk/embedded asset serving. Keep help/uninstall processing before server initialization. Missing API routes must return 404 before the SPA fallback. Listen on loopback.

Orca is the lifecycle source of truth. Task specs/titles/deps are immutable; legitimate followups create new work after native reconciliation. Never reset all Runs. Load the installed version-matched orchestration guide before any coordination action.

## Commands

- npm ci --registry=https://registry.npmjs.org --ignore-scripts
- npm test
- ./node_modules/.bin/tsc -p server/tsconfig.json --noEmit
- npm run build:npm (includes web typecheck/build)
- node scripts/check-skill.mjs [explicit-skill-file]
- npm run dev (Vite and API)

There is no separate lint/fmt/vet script. Optional build:binary requires Bun. Tests use Node's runner and existing tsx. Test fixtures must isolate Orca commands and never mutate a live Run. UI verification uses Orca's embedded browser.

## Data and UI

web/src/viewConfig.ts owns layout/Run preferences. Hydrate before auto-selecting a Run; failed hydration must not overwrite saved preferences. Preserve historic harness/model/concurrency config keys as user data without consuming them for execution or attribution. The history checkbox stays page-local.

Keep native dispatchId and assigneeHandle paired through projection, browser types, fixtures, and display. Do not infer a model from viewer preferences. Active-history filtering retains original ancestor edges and unresolved-gate tasks. Whole-Run counts are independent of visibility. Abort/ignore stale requests when switching Runs and visibly label failed refreshes.

Preserve manual node positions during ordinary polling. New React Flow nodes must retain measured dimensions to prevent edge flicker. Crayon SVG filters and animations are deliberate; avoid incidental redesign.

## Skills and distribution

skill/SKILL.md is the packaged workflow. Its name/frontmatter must remain discoverable. In utils it is mirrored byte-for-byte into claude/base/skills/orca-dag/SKILL.md; preserve deployed symlinks. Keep initial skill self-contained because package/binary installers distribute SKILL.md.

The bundled installer and uninstaller must remain symmetric, avoid writing through symlinked skill directories, and support --no-skill / ORCA_DAG_NO_SKILL=1. Uninstall may clean coordinator terminals left by older versions; this is separate from observation and must never serve as active worker cleanup.

Build scripts generate dist-npm, web/dist, dist, and server/src/generated/webAssets.ts. Never hand-edit or commit these or node_modules/runtime preferences. The packaged server remains at dist/server/index.mjs because the SPA fallback resolves ../../web/dist from there. Preserve both npm and embedded-asset boot paths.

Commit/push the personal fork before updating the parent submodule pointer and deployed mirror. Retain MIT notices. Do not publish npm packages/tags as part of personal deployment. Existing release tooling is a separately authorized workflow.

## Documentation and style

Use strict ESM TypeScript. Web enables noUnusedLocals/noUnusedParameters. Comments explain persistent code behavior. Update README.md and its README_zh.md translation together. User communication and new UI strings are English. Specifications/evidence belong in work-vault, never Desktop or the public fork.

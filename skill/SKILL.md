---
name: orca-dag
description: "Use when planning an Orca task DAG, turning an accepted group specification into supervised implementation, or extending a delivery through review and progressive increments."
---

# Orca DAG workflow

The conversational coordinator owns execution, questions, decisions, verification,
and cleanup. The viewer observes native Orca state. Work-vault holds the contract
and evidence. A Run is a durable namespace/inbox; a Task is work; a Dispatch is
one authoritative attempt. Task completion does not establish delivery acceptance.

## Choose the entry path

| Available input | Next action |
|---|---|
| Planning-only request | Write the plan in work-vault; create no Run or workers. |
| Accepted specification | Verify its bytes and scope, then decompose authorized implementation. |
| User-selected group discussion | Use group to produce and check the delivery specification. |
| Unresolved requirements | Discuss with the user; resolve material unknowns before dependent work. |
| Feedback on delivered work | Classify the increment using the table below. |

Resolve `orca` using the installed orchestration skill's platform rules. Before
coordination, read `orca skills get orchestration` with that executable. Its
version-matched contract governs lifecycle commands. Load conditional references
only when their action applies. Use orca-cli for worktree/terminal ownership.

## Establish the delivery specification

Cover one agreed delivery: observable behavior, interfaces, ownership, constraints,
exclusions, and acceptance checks. Future increments remain open. Write work
artifacts under `~/work-vault`; honor its local instructions. Ask one material
question at a time through the runtime's permitted structured question UI. Carry
existing user decisions and authorization forward.

Use this document structure:

```markdown
# Delivery specification
## Outcome and scope
## Observable behavior and interfaces
## Constraints and ownership
## Acceptance examples and verification commands
## Exclusions
## Resolved design decisions and supporting evidence
## Human decisions and unresolved choices
```

### Group-authored entry

Use the existing group skill with the user's named sessions or membership already
explicitly established for this topic. Missing membership requires clarification;
never choose unrelated sessions, replace members, or launch extra agents.
Importing an existing group document sends no member messages.

Give the group's single `discussion.md` the specification structure above from
the outset. Its existing `--output` option can place the document under a new
`~/work-vault/sessions/design/<topic>/` directory. Group runtime state stays at
its local state root. The group owns discussion and relevant read-only inquiry.
Use its finite rounds, current-input checks, human-steering pause, and explicit
continuation rules; load the group workflow for their exact mechanics.

Attribute agreement only to current responses about the reviewed revision.
Record dissent and the user's choices. Exhausted allowance or a finished group
does not imply consensus, human acceptance, or implementation authorization.
Material changes after the final check remain visibly unchecked. Unavailable
members are disclosed. Resolve acceptance-critical unknowns before dependent work.

When the user accepts the reviewed document, preserve a byte-for-byte
`accepted-spec.md` snapshot beside it and compute SHA-256. Do not rewrite or
append metadata to those accepted bytes. In the implementation brief record the
group/design Run IDs, input revision, accepted digest, human decision reference,
and unresolved-item dispositions. This is a frozen version, not a second living spec.

Finish or pause group discussion and account for outstanding assignments before
switching the same coordinator to implementation. Keep member sessions open.
Create a separate implementation Run, referencing the design Run and snapshot
in task briefs; cross-Run dependency edges and reused discussion Dispatch IDs
are invalid. Decompose the accepted contract without repeating the interview.
If execution was already authorized, proceed without another approval ritual.

## Execute the bounded delivery

Create a Run only when coordination is requested/authorized. Build tasks with
native `task-create` and real same-Run dependencies, then verify with `task-list`.
Use the native guide for exact flags and worker placement. Parallel writers need
explicit disjoint ownership or isolated worktrees. Never substitute a second
viewer scheduler or non-Orca subagents for supervised provenance.

Each task brief contains:

```text
Target: exact component/files and allowed worktree.
Change: bounded result to produce.
Contract: accepted spec path, digest, relevant sections and essential constraints.
Inputs: baseline revision and relevant prior task/report references.
Ownership: coordinator, allowed writer, review role, do-not-touch boundaries.
Acceptance: commands and observable evidence required.
Questions: ask the coordinator when a material fact is missing.
Result: report path and exact tested/reviewed revision or content digest.
```

Include enough bounded contract content to execute; link deeper evidence instead
of copying the entire discussion into every worker. The coordinator handles the
native mailbox, questions, settlement, reuse/retention/release, and acknowledgment.
An enqueue receipt proves neither acceptance nor completion. A timeout is a
checkpoint. Verify reported results against the actual artifacts.

Human decisions stay in the coordinator conversation. Use a native gate only
when a real dependency requires one; ordinary questions use ask/reply. Existing
skills selected by the user retain their own rules. Do not automatically invoke
collaborate, shadow, claude, or group, or claim their subprocesses are Dispatches.

## Handle progressive increments

| Feedback | Contract action | Work/history action |
|---|---|---|
| Existing contract violated | Keep accepted contract | Add related repair/review work; verify fresh artifacts. |
| Desired behavior/interface changes | Agree the affected amendment | Implement the delta with affected regression checks. |
| Material design unknown | Investigate and resolve that slice | Hold dependent work; reconvene group only when requested. |
| Substantial separate delivery | Establish its bounded spec | New implementation Run with previous outcome references. |

Small related iterations remain in the Run. Record previous outcome references,
requested delta, contract impact, affected scope, and acceptance in the increment
brief. Preserve completed tasks and evidence; changed bytes require fresh checks.
Stored task specs/titles/dependencies are immutable. Reconcile obsolete unstarted
work using the native contract before replacing it. Never reset all Runs or
evade an existing failed attempt's recovery/circuit-breaker rules by renaming work.

## Observe and hand off

For the utils installation, start `node ~/.orca/orca-dag/start.mjs` and open
`http://127.0.0.1:8787`. Other installations use their built viewer entrypoint.
Select the Run; inspect task specs/results and native dispatch/terminal IDs.
The viewer cannot start/stop workers, create Runs, resolve gates, or reset tasks.
Its completed-history toggle preserves active dependencies. Design and
implementation Runs appear separately; consensus remains in the spec document.

Finish with the outcome, exact evidence, unresolved choices, and each worker's
ownership/cleanup disposition. Preserve a resumable work-vault checkpoint when
needed. Record actual token usage when available; do not infer savings from
instruction length or elapsed time.

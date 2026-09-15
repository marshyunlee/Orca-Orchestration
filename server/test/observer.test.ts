import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createViewerApp } from "../src/app";

test("HTTP observation cannot mutate orchestration", async () => {
  const directory = await mkdtemp(join(tmpdir(), "orca-observer-"));
  const previousPath = process.env.PATH;
  // Any unexpected CLI call is observable and cannot reach the real runtime.
  await writeFile(join(directory, "orca"), '#!/bin/sh\necho invoked >> "' + directory + '/calls"\nexit 1\n', { mode: 0o755 });
  process.env.PATH = directory;
  const server = createViewerApp(directory).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}`;
  try {
    for (const path of ["/api/runs", "/api/run", "/api/run-stop", "/api/gates/gate_test/resolve", "/api/reset"]) {
      const response = await fetch(url + path, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ objective: "test", runId: "run_test", resolution: "approved", confirmAllRuns: true }),
      });
      assert.equal(response.status, 404, path);
    }
    assert.equal((await fetch(url + "/api/health")).status, 200);
    assert.equal((await fetch(url + "/api/dag")).status, 400);
    await assert.rejects(readFile(join(directory, "calls")), { code: "ENOENT" });

    const preferences = { defaultHarness: "codex", harnessByTask: { task_old: "claude" }, modelByTask: { task_old: "opus" }, maxConcurrency: 2, runId: "run_old", layout: "force" };
    await writeFile(join(directory, ".orca-dag.config.json"), JSON.stringify(preferences));
    const response = await fetch(url + "/api/config", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId: "run_new", layout: "layered-lr" }),
    });
    assert.equal(response.status, 200);
    const saved = await (await fetch(url + "/api/config")).json();
    assert.deepEqual(saved, { ...preferences, runId: "run_new", layout: "layered-lr" });
    assert.deepEqual(JSON.parse(await readFile(join(directory, ".orca-dag.config.json"), "utf8")), saved);

    const native = { ok: true, result: {
      runs: [{ id: "run_native", objective: "Native work", coordinator_handle: "term_owner", consumer_generation: 7, legacy: 0, created_at: "2026-09-15" }],
      tasks: [{ id: "task_native", run_id: "run_native", parent_id: null, created_by_terminal_handle: "term_owner", spec: "Pinned contract", status: "dispatched", deps: "[]", result: "Existing evidence", created_at: "2026-09-15", completed_at: null, task_title: "Native task", display_name: null, dispatch_id: "dispatch_native", assignee_handle: "term_worker" }],
      gates: [{ id: "gate_native", task_id: "task_native", question: "Proceed?", options: '["yes","no"]', status: "pending", resolution: null }],
    } };
    await writeFile(join(directory, "orca"), '#!/bin/sh\nprintf "%s\\n" "$*" >> "' + directory + '/calls"\nprintf "%s\\n" \'' + JSON.stringify(native) + '\'\n', { mode: 0o755 });
    const runs = await (await fetch(url + "/api/runs")).json();
    assert.equal(runs.runs[0].consumer_generation, 7);
    const dag = await (await fetch(url + "/api/dag?run=run_native")).json();
    assert.deepEqual(dag.nodes[0], { id: "task_native", label: "Native task", status: "dispatched", spec: "Pinned contract", result: "Existing evidence", createdAt: "2026-09-15", completedAt: null, dispatchId: "dispatch_native", assigneeHandle: "term_worker" });
    assert.deepEqual(dag.gates[0].options, ["yes", "no"]);
    assert.equal(dag.gates[0].taskId, "task_native");
    assert.deepEqual((await readFile(join(directory, "calls"), "utf8")).trim().split("\n").sort(), [
      "orchestration gate-list --run run_native --json",
      "orchestration run-list --limit 50 --json",
      "orchestration task-list --run run_native --json",
    ]);
  } finally {
    process.env.PATH = previousPath;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});

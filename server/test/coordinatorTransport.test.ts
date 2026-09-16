import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeNativeOperation, type CoordinatorCaller } from "../src/orca.js";

test("coordinator transport preserves receipts, process ownership, and uncertain outcomes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "board-transport-"));
  const executable = join(directory, "orca");
  const log = join(directory, "argv.jsonl");
  const caller: CoordinatorCaller = { identity: "codex:fixture", terminalHandle: "term_fixture", incarnationId: "inc_fixture", hostId: "local" };
  const previous = process.env.ORCA_TERMINAL_HANDLE;
  process.env.ORCA_TERMINAL_HANDLE = caller.terminalHandle;
  await writeFile(executable, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args)+'\\n');
if (args[0] === 'terminal') {
 console.log(JSON.stringify({ok:true,result:{terminal:{handle:'term_fixture',incarnationId:'inc_fixture',executionHostId:'local',agentIdentity:'codex',connected:true,writable:true}}}));
} else if (args.includes('timeout')) {
 fs.writeFileSync(${JSON.stringify(join(directory, "effect"))}, 'created');
 setTimeout(()=>{},10000);
} else if (args.includes('failure')) {
 console.log(JSON.stringify({ok:false,error:{code:'consumer_fenced',message:'fenced'},result:{requestId:'request_failed',stage:'failed',residualResources:{taskId:'task_partial'}}}));
 process.exitCode=1;
} else {
 console.log(JSON.stringify({ok:true,result:{mutation:{requestId:'request_fixture',replayed:false},stage:'ready',dispatchId:'dispatch_fixture',liveness:'live'}}));
}
`, { mode: 0o755 });
  const options = { executable, timeoutMs: 3000 };
  try {
    const receipt = await executeNativeOperation({ kind: "send-guidance", dispatchId: "dispatch_fixture", body: "Use revised input" }, caller, options);
    assert.equal(receipt.requestId, "request_fixture");
    assert.equal(receipt.phase, "applied");
    assert.equal(receipt.stage, "ready");
    let commands = (await readFile(log, "utf8")).trim().split("\n").map(line => JSON.parse(line));
    assert.deepEqual(commands.at(-1), ["orchestration", "send", "--to", "dispatch:dispatch_fixture", "--subject", "Board guidance", "--body", "Use revised input", "--from", "term_fixture", "--json"]);
    await executeNativeOperation({ kind: "start-worker", taskId: "task_fixture", runId: "run_fixture", assignment: { kind: "member", terminalHandle: "term_member", workspacePath: "/fixture", model: "must-not-apply" } } as never, caller, options);
    commands = (await readFile(log, "utf8")).trim().split("\n").map(line => JSON.parse(line));
    assert.deepEqual(commands.at(-1), ["orchestration", "dispatch", "--task", "task_fixture", "--to", "term_member", "--run", "run_fixture", "--inject", "--from", "term_fixture", "--json"]);
    await executeNativeOperation({kind:"start-worker",taskId:"task_fixture",runId:"run_fixture",retryOf:"previous",assignment:{kind:"member",terminalHandle:"term_member",workspacePath:"/fixture"}},caller,options);
    commands=(await readFile(log,"utf8")).trim().split("\n").map(line=>JSON.parse(line));
    assert.deepEqual(commands.at(-1),["orchestration","worker-start","--task","task_fixture","--terminal","term_member","--worktree","path:/fixture","--run","run_fixture","--from","term_fixture","--retry-of","previous","--json"]);
    await assert.rejects(executeNativeOperation({ kind: "start-worker", taskId: "task_fixture", runId: "run_fixture", assignment: { kind: "member", terminalHandle: "term_fixture", workspacePath: "/fixture" } }, caller, options), /coordinator.*handover/);
    await executeNativeOperation({ kind: "stop-worker", dispatchId: "dispatch_fixture" }, caller, options);
    commands = (await readFile(log, "utf8")).trim().split("\n").map(line => JSON.parse(line));
    assert.deepEqual(commands.at(-1), ["orchestration", "worker-stop", "--dispatch", "dispatch_fixture", "--json"]);
    const failed = await executeNativeOperation({ kind: "create-run", objective: "failure" }, caller, options);
    assert.equal(failed.phase, "failed");
    assert.equal(failed.requestId, "request_failed");
    assert.equal((failed.raw as any).result.residualResources.taskId, "task_partial");
    const unknown = await executeNativeOperation({ kind: "create-run", objective: "timeout" }, caller, options);
    assert.equal(unknown.phase, "unknown");
    assert.equal(unknown.requestId, null);
    assert.equal(await readFile(join(directory, "effect"), "utf8"), "created");
    delete process.env.ORCA_TERMINAL_HANDLE;
    await assert.rejects(executeNativeOperation({kind:"send-guidance",dispatchId:"dispatch_fixture",body:"No implicit identity"},caller,options),/coordinator process/);
    assert.equal((await executeNativeOperation({kind:"send-guidance",dispatchId:"dispatch_fixture",body:"Own verified explicit identity"},caller,{...options,callerTerminal:caller.terminalHandle})).phase,"applied");
    process.env.ORCA_TERMINAL_HANDLE = "term_other";
    await assert.rejects(executeNativeOperation({kind:"send-guidance",dispatchId:"dispatch_fixture",body:"Wrong inherited identity"},caller,{...options,callerTerminal:caller.terminalHandle}),/coordinator process/);
    await assert.rejects(executeNativeOperation({ kind: "create-run", objective: "cannot impersonate" }, caller, options), /coordinator process/);
  } finally {
    if (previous === undefined) delete process.env.ORCA_TERMINAL_HANDLE;
    else process.env.ORCA_TERMINAL_HANDLE = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

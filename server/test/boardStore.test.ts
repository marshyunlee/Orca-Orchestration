import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBoardStore } from "../src/boardStore.js";

test("board revisions survive restart, reject competing writers and stale edits, and replay actions", async () => {
  const root = await mkdtemp(join(tmpdir(), "board-store-"));
  const store = await createBoardStore(root);
  try {
    await assert.rejects(createBoardStore(root), /writer/);
    const first = await store.create({ title: "First", members: [], coordinatorIdentity: "" }, "create-first");
    assert.equal(first.nodes.filter(node => node.kind === "run").length, 1);
    assert.equal((await store.create({ title: "Duplicate", members: [], coordinatorIdentity: "" }, "create-first")).id, first.id);
    const second = await store.create({ title: "Second", members: [], coordinatorIdentity: "" }, "create-second");
    const edited = await store.update(first.id, first.revision, "edit-first", board => ({ ...board, title: "Edited" }));
    assert.equal((await store.read(second.id)).title, "Second");
    assert.equal((await store.update(first.id, first.revision, "edit-first", () => { throw new Error("replayed mutation ran"); })).revision, edited.revision);
    await assert.rejects(store.update(first.id, first.revision, "stale", board => board), /revision conflict/);
    await writeFile(join(root, first.id, "board.json.interrupted.tmp"), "broken partial snapshot");
    await store.close();
    const reopened = await createBoardStore(root);
    try { assert.equal((await reopened.read(first.id)).title, "Edited"); }
    finally { await reopened.close(); }
  } finally { await store.close(); await rm(root, { recursive: true, force: true }); }
});

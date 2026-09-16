import assert from "node:assert/strict";
import {test} from "node:test";
import {mkdtemp,writeFile,readFile,symlink,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {readWorkspaceFile,applyWorkspaceEdits,previewWorkspaceDiff} from "../src/workspaceEdits.js";

test("explicit application rejects stale files and escaping symlinks while preserving unrelated changes",async()=>{
 const root=await mkdtemp(join(tmpdir(),"workspace-edits-")),outside=await mkdtemp(join(tmpdir(),"outside-"));
 try{
  await writeFile(join(root,"source.ts"),"before\n");await writeFile(join(root,"unrelated.ts"),"human change\n");await symlink(outside,join(root,"escape"));
  const opened=await readWorkspaceFile(root,"source.ts");
  await writeFile(join(root,"source.ts"),"agent change\n");
  await assert.rejects(applyWorkspaceEdits(root,[{path:"source.ts",baseDigest:opened.baseDigest,content:"overwrite"}],join(root,"journal")),/conflict/i);
  assert.equal(await readFile(join(root,"source.ts"),"utf8"),"agent change\n");
  await assert.rejects(readWorkspaceFile(root,"../outside"),/workspace|path/i);
  await assert.rejects(applyWorkspaceEdits(root,[{path:"escape/new",baseDigest:null,content:"escape"}],join(root,"journal")),/workspace|path/i);
  const current=await readWorkspaceFile(root,"source.ts");
  await applyWorkspaceEdits(root,[{path:"source.ts",baseDigest:current.baseDigest,content:"human edit\n"}],join(root,"journal"));
  assert.equal(await readFile(join(root,"source.ts"),"utf8"),"human edit\n");assert.equal(await readFile(join(root,"unrelated.ts"),"utf8"),"human change\n");
  const preview=await previewWorkspaceDiff(root,"--- a/source.ts\n+++ b/source.ts\n@@ -1 +1 @@\n-human edit\n+reviewed patch\n");
  assert.equal(preview[0].content,"reviewed patch\n");assert.equal(await readFile(join(root,"source.ts"),"utf8"),"human edit\n");
 }finally{await rm(root,{recursive:true,force:true});await rm(outside,{recursive:true,force:true});}
});

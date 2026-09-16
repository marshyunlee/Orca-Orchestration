import assert from "node:assert/strict";
import { test } from "node:test";
import { projectSessions } from "../src/sessionDiscovery.js";

test("duplicate labels remain distinct identities and changed or disconnected bindings stay unavailable",()=>{
 const rows=[{tab_name:"WORK",tab_id:"tab-one",terminal_handle:"term-one",source:"codex",session_id:"first",worktree_path:"/one"},{tab_name:"WORK",tab_id:"tab-two",terminal_handle:"term-two",source:"codex",session_id:"second",worktree_path:"/two"}];
 const terminals=rows.map(row=>({handle:row.terminal_handle,agentIdentity:"codex",connected:true,writable:true,incarnationId:"inc",executionHostId:"local"}));
 const result=projectSessions(rows,terminals);
 assert.deepEqual(result.members.map(member=>member.identity),["codex:first","codex:second"]);
 terminals[1].connected=false;
 assert.equal(projectSessions(rows,terminals).members.length,1);
 assert.equal(projectSessions(rows,terminals).unavailable[0].terminalHandle,"term-two");
});

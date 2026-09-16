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

test('persisted native session titles require exact live PTY and incarnation bindings',async()=>{
 const {resolvePersistedSession}=await import('../src/persistedSessions.js');
 const row={tab_id:'tab',source:'claude',terminal_handle:'term'};
 const terminal={handle:'term',ptyId:'pty',tabId:'tab',leafId:'leaf',incarnationId:'inc',executionHostId:'local'};
 const state={workspaceSession:{tabsByWorktree:{workspace:[{id:'tab',ptyId:'pty',aiVaultTitle:{agent:'claude',sessionId:'session-id'}}]},terminalPtyIncarnationsByPaneKey:{'tab:leaf':'inc'}}};
 assert.equal(resolvePersistedSession(row,terminal,state),'session-id');
 assert.equal(resolvePersistedSession(row,{...terminal,incarnationId:'restarted'},state),null);
 assert.equal(resolvePersistedSession(row,{...terminal,ptyId:'different'},state),null);
 assert.equal(resolvePersistedSession(row,{...terminal,executionHostId:'remote'},state),null);
 assert.equal(resolvePersistedSession({...row,source:'codex'},terminal,state),null);
});

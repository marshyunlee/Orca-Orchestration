import assert from "node:assert/strict";
import { test } from "node:test";
import { groupMemberPayload } from "../src/groupAdapter.js";

test("group payload retains stable identity and transport incarnation independently of mutable tab labels",()=>{
 assert.deepEqual(groupMemberPayload({identity:"codex:session",source:"codex",sessionId:"session",tabId:"tab",tabName:"RENAMED",terminalHandle:"term",incarnationId:"inc",hostId:"local",workspacePath:"/workspace"}),{identity:"codex:session",domain:"RENAMED",handle:"term",incarnation:"inc",host:"local"});
});

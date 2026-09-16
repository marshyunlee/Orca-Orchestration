#!/usr/bin/env node
import { resolveBoardEntry, resolveEntryMembers, resolveEntryRole } from "./boardEntry.js";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { executeNativeOperation, normalizeNativeReceipt, runOrca, type CoordinatorCaller, type NativeOperation } from "./orca.js";
import type { LaunchPermit } from "./executionBridge.js";
import { callGroupHelper, groupMemberPayload, updateGroupMembers } from "./groupAdapter.js";
import type { BoardSnapshot, MemberRef } from "../../shared/board.js";

const args=process.argv.slice(2);
function option(name:string, fallback?:string):string {
  const index=args.indexOf(name);if(index>=0 && args[index+1])return args[index+1];
  if(fallback!==undefined)return fallback;
  throw new Error(`Missing ${name}`);
}
const callerHandle=option("--terminal",process.env.ORCA_TERMINAL_HANDLE??"");
if(process.env.ORCA_TERMINAL_HANDLE && callerHandle!==process.env.ORCA_TERMINAL_HANDLE)throw new Error("Explicit caller differs from this terminal");
const url=option("--url",process.env.ORCA_BOARD_URL??"http://127.0.0.1:8787");
async function request<T>(path:string,body?:unknown):Promise<T>{
  const parsed=new URL(url);
  if(parsed.protocol!=="http:" || !["127.0.0.1","localhost"].includes(parsed.hostname))throw new Error("boardctl requires the local board server");
  const token=await readFile(option("--token-file",join(process.env.ORCA_BOARD_RUNTIME??join(homedir(),".local","state","orca-board"),`token-${parsed.port||80}`)),"utf8");
  const response=await fetch(url+path,{method:body===undefined?"GET":"POST",headers:{"Content-Type":"application/json","x-board-token":token},body:body===undefined?undefined:JSON.stringify(body)});
  const result=await response.json() as Record<string,unknown>;
  if(!response.ok)throw new Error(String(result.error??response.status));
  return result as T;
}
async function selectedCaller(board:BoardSnapshot):Promise<CoordinatorCaller>{
  const member=board.members.find(member=>member.identity===board.coordinatorIdentity);
  if(!member || member.terminalHandle!==callerHandle)throw new Error("Run boardctl inside the selected coordinator session");
  const {terminal}=await runOrca<{terminal:{incarnationId:string;executionHostId:string;agentIdentity:string}}>(["terminal","show","--terminal",member.terminalHandle]);
  if(terminal.incarnationId!==member.incarnationId || terminal.executionHostId!==member.hostId || terminal.agentIdentity!==member.source)throw new Error("Coordinator binding changed");
  return {identity:member.identity,terminalHandle:member.terminalHandle,incarnationId:member.incarnationId,hostId:member.hostId};
}
async function main():Promise<void>{
  if(!args.length || args.includes("--help")){
    console.log(`boardctl <command> --board <id> [--url http://127.0.0.1:8787]
  create --title <title> --members <JSON names> --request <text> --action <stable-id>
                               Create a shared board and queue group discussion
  resume [--board <id> | --title <exact-title>]
                               Resume the existing delivery in your assigned role
  owner-claim --action <id>     Claim a control as the original execution owner
  owner-finish --action <id> --stage acknowledged|applied --evidence <text>
  collect                      Refresh saved/native context and request fresh summaries
  collection-send --request <id>   Coordinator sends one pending request
  collection-publish --request <id> --file <summary.json>   Requested member responds
  collection-reconcile --request <id>   Inspect the original send receipt
  read                         Read board, revisions, digests, queued actions and attempts
  claim --action <id>           Claim one coordinator action before doing work
  publish --action <id> --base-revision <n> --file <proposal.json>
  group-init                   Initialize and attach the shared group runtime
  reconcile --action <id>       Recover the exact recorded native operation
  execute-action --action <id>  Execute a claimed human action
  component-refresh --node <id> --action <id>  Refresh the bound manifest from its master
  component-approve --node <id> --digest <digest> --source-file <JSON> --action <id>
                               Record an actual human response to the exact gate
  component-claim --node <id> --action <id>    Claim an action as its component master
  component-finish --node <id> --action <id> --evidence <text>
                               Record action handling; does not settle native workers
  component-result --node <id> --action <id> --file <JSON>
                               Publish validated selected candidate evidence
  launch --node <id>            Admit and start one ready node from this coordinator
  attest-stop --attempt <id> --evidence <text>   Member confirmation after stopping all work
  native --caller-file <json> --operation-file <json>

Proposal JSON:
  {"kind":"spec","text":"Specification","messages":[{"author":"codex:SESSION","body":"Contribution"}]}
  {"kind":"graph","nodes":[{"id":"task-name","kind":"task","title":"Task","revision":1,"content":{"prompt":"Self-contained task","plan":"","design":"","implementationNotes":""},"assignment":{"kind":"member","identity":"codex:SESSION"},"position":{"x":400,"y":100},"removed":false}],"edges":[{"id":"root-task","source":"RUN_NODE_ID","target":"task-name"}]}
  {"kind":"preview","text":"Expected examples, behavior and acceptance criteria","specDigest":"FROM_READ","graphDigest":"FROM_READ"}

Summary JSON: {"goals":"Current goals","acceptedScope":"Original approval","blockers":"","documents":[],"items":[{"itemId":"stable-work-id","sourceIdentity":"codex:SESSION","ownerIdentity":"codex:SESSION","ownerHandle":"OWN_HANDLE","native":null,"title":"Existing work","content":{"prompt":"Scope","plan":"","design":"","implementationNotes":""},"status":"running","observedAt":"ISO timestamp","references":[],"dependencies":[],"resultPath":null}]}
Native summaries must use an already observed native binding. Narrative status is agent-reported. Report from your own selected session only.

Component node: add "collaborate":{"masterIdentity":"codex:SESSION","manifestPath":"/absolute/work-vault/sessions/collaborate/HOST/RUN/manifest.json"}, with "assignment":null.
Component result JSON: {"nodeRevision":1,"selectionPath":"/run/outcome/slice.json","candidateStatePath":"/bulk/candidates/impl-opus/state.json","gateResultPath":"/bulk/candidates/impl-opus/gate-result.json"}.
Gate source JSON: {"kind":"chat","reference":"/work-vault/actual-user-answer.md","response":"EXACT USER APPROVAL"}. Reuse actual approval only for the matching digest.

Preview proposals may include images: [{"mimeType":"image/png","base64":"...","caption":"Expected screen"}] (up to eight, 1 MB each; the full API payload is limited to 2 MB).
Use --terminal <your-own-handle> when the tool shell lacks inherited Orca identity, and --token-file <private-runtime/token-PORT> for a nondefault runtime. Verify that the selected terminal is your actual session; never borrow another session identity. Native operations run only for the selected coordinator. Unknown receipts require reconciliation; never repeat an unknown mutation blindly.`);return;
  }
  if(args[0]==="native"){
    const caller=JSON.parse(await readFile(option("--caller-file"),"utf8")) as CoordinatorCaller;
    const operation=JSON.parse(await readFile(option("--operation-file"),"utf8")) as NativeOperation;
    const receipt=await executeNativeOperation(operation,caller,{callerTerminal:callerHandle});console.log(JSON.stringify(receipt));if(receipt.phase!=="applied")process.exitCode=1;return;
  }
  if(args[0]==="create"){
    const inventory=await request<{members:MemberRef[]}>("/api/sessions");
    const handle=callerHandle;
    const members=resolveEntryMembers(inventory.members,JSON.parse(option("--members","[]")),handle);
    const actionId=option("--action"),body=option("--request");
    let created=await request<BoardSnapshot>("/api/boards",{title:option("--title"),members,coordinatorIdentity:members[0].identity,actionId});
    await selectedCaller(created);
    const root=created.nodes.find(node=>node.kind==="run")!;
    created=await request<BoardSnapshot>(`/api/boards/${created.id}/edit`,{baseRevision:created.revision,actionId:`${actionId}-root`,operation:{kind:"edit-node",nodeId:root.id,title:root.title,content:{...root.content,prompt:body},assignment:null}});
    
    console.log(JSON.stringify({board:created,url,role:"coordinator",collectionQueued:true}));return;
  }
  if(args[0]==="resume"){
    const {boards}=await request<{boards:BoardSnapshot[]}>("/api/boards");
    const selected=resolveBoardEntry(boards,{id:args.includes("--board")?option("--board"):undefined,title:args.includes("--title")?option("--title"):undefined});
    const role=resolveEntryRole(selected,callerHandle);
    const member=selected.members.find(member=>member.identity===role.identity)!;
    const {terminal}=await runOrca<{terminal:{incarnationId:string;executionHostId:string;agentIdentity:string}}>(["terminal","show","--terminal",member.terminalHandle]);
    if(terminal.incarnationId!==member.incarnationId || terminal.executionHostId!==member.hostId || terminal.agentIdentity!==member.source)throw new Error("Session binding changed; reselect it before resuming");
    console.log(JSON.stringify({board:selected,url,...role}));return;
  }
  const id=option("--board");
  const board=await request<BoardSnapshot>(`/api/boards/${encodeURIComponent(id)}`);
  if(args[0]==="read"){console.log(JSON.stringify(board,null,2));return;}
  if(args[0]==="owner-claim" || args[0]==="owner-finish"){
    const member=board.members.find(member=>member.terminalHandle===callerHandle);
    if(!member)throw new Error("Run owner commands from your selected session");
    console.log(JSON.stringify(await request(`/api/boards/${id}/collection/${args[0]}`,{identity:member.identity,actionId:option("--action"),...(args[0]==="owner-finish"?{stage:option("--stage"),evidence:option("--evidence")}:{})})));return;
  }
  if(args[0]==="collect"){
    await selectedCaller(board);console.log(JSON.stringify(await request(`/api/boards/${id}/collection/refresh`,{})));return;
  }
  if(args[0]==="collection-publish"){
    const entry=board.collection.requests.find(entry=>entry.id===option("--request"));
    if(!entry || entry.member.terminalHandle!==callerHandle)throw new Error("Publish from the requested session itself");
    console.log(JSON.stringify(await request(`/api/boards/${id}/collection/publish`,{identity:entry.member.identity,requestId:entry.id,summary:JSON.parse(await readFile(option("--file"),"utf8"))})));return;
  }
  if(args[0]==="collection-send" || args[0]==="collection-reconcile"){
    const caller=await selectedCaller(board),entry=board.collection.requests.find(entry=>entry.id===option("--request"));
    if(!entry)throw new Error("Collection request not found");
    let receipt;
    if(args[0]==="collection-reconcile"){
      if(!entry.requestId)throw new Error("No native request identity was received; inspect original send evidence, do not resend");
      const inspected=await executeNativeOperation({kind:"inspect-request",requestId:entry.requestId},caller,{callerTerminal:callerHandle});
      const result=(inspected.raw as {result?:{state?:string;receipt?:unknown}}).result;
      if(inspected.phase!=="applied" || result?.state!=="completed" || !result.receipt)throw new Error("Original request has not completed; keep the request pending");
      receipt=normalizeNativeReceipt({ok:true,result:result.receipt});receipt.requestId??=entry.requestId;
    }else{
      const operation=await request<NativeOperation>(`/api/boards/${id}/collection/operation`,{identity:caller.identity,requestId:entry.id});
      receipt=await executeNativeOperation(operation,caller,{callerTerminal:callerHandle});
    }
    console.log(JSON.stringify(await request(`/api/boards/${id}/collection/delivery`,{identity:caller.identity,requestId:entry.id,receipt})));return;
  }
  if(args[0]==="attest-stop"){
    const member=board.members.find(member=>member.terminalHandle===callerHandle);
    if(!member)throw new Error("Run stop acknowledgment from the assigned member session");
    console.log(JSON.stringify(await request(`/api/boards/${id}/member/stopped`,{identity:member.identity,attemptId:option("--attempt"),evidence:option("--evidence")})));return;
  }
  if(args[0]==="component-refresh" || args[0]==="component-approve" || args[0]==="component-result" || args[0]==="component-claim" || args[0]==="component-finish"){
    const role=resolveEntryRole(board,callerHandle);
    const nodeId=option("--node");
    const operation=args[0].slice("component-".length);
    const data:Record<string,unknown>={identity:role.identity,actionId:option("--action")};
    if(operation==="finish")data.evidence=option("--evidence");
    if(operation==="result")data.proposal={...JSON.parse(await readFile(option("--file"),"utf8")),identity:role.identity};
    if(operation==="approve"){
      data.digest=option("--digest");
      data.source=JSON.parse(await readFile(option("--source-file"),"utf8"));
    }
    console.log(JSON.stringify(await request(`/api/boards/${id}/components/${nodeId}/${operation}`,data)));return;
  }
  const caller=await selectedCaller(board);
  const integrations=await request<{boardRoot:string;groupHelper:string|null;sessionResolver:string|null}>("/api/integrations");
  if(integrations.groupHelper)process.env.ORCA_GROUP_HELPER=integrations.groupHelper;
  if(integrations.sessionResolver)process.env.ORCA_WORK_CONTEXT_HELPER=integrations.sessionResolver;
  process.env.ORCA_BOARD_ROOT=integrations.boardRoot;
  if(args[0]==="claim"){
    console.log(JSON.stringify(await request(`/api/boards/${id}/coordinator/claim`,{identity:caller.identity,actionId:option("--action")})));return;
  }
  if(args[0]==="publish"){
    const proposal=JSON.parse(await readFile(option("--file"),"utf8"));
    console.log(JSON.stringify(await request(`/api/boards/${id}/coordinator/publish`,{identity:caller.identity,actionId:option("--action"),baseRevision:Number(option("--base-revision")),proposal})));return;
  }
  if(args[0]==="reconcile"){
    const action=board.actions.find(action=>action.id===option("--action"));
    if(!action || !action.payload || typeof action.payload!=="object")throw new Error("Action not found");
    const data=action.payload as Record<string,unknown>;
    const token=data.operationToken??data.effectToken;
    if(data.membershipToken && board.discussionGroupId){
      const receipt=await callGroupHelper(["status","--group",board.discussionGroupId]);
      console.log(JSON.stringify(await request(`/api/boards/${id}/coordinator/membership-receipt`,{identity:caller.identity,actionId:action.id,token:data.membershipToken,receipt})));return;
    }
    if(!token || !data.operation)throw new Error("No admitted native operation; inspect delivery or group state before retrying");
    if(!action.requestId)throw new Error("No request ID was received. Inspect the exact frozen Run/task/dispatch in native state; the board will not blindly resend");
    const inspection=await executeNativeOperation({kind:"inspect-request",requestId:action.requestId},caller,{callerTerminal:callerHandle});
    if(inspection.phase!=="applied")throw new Error("Native request inspection failed; outcome remains unknown");
    const inspected=(inspection.raw as {result?:{state?:string;receipt?:unknown}}).result;
    if(!inspected || !["completed","pending"].includes(inspected.state??""))throw new Error(`Native request is ${inspected?.state??"unverifiable"}; inspect affected native state before retrying`);
    const receipt=inspected.state==="completed" && inspected.receipt
      ? normalizeNativeReceipt({ok:true,result:inspected.receipt})
      : await executeNativeOperation(data.operation as NativeOperation,caller,{retryRequest:action.requestId,callerTerminal:callerHandle});
    const endpoint=action.kind==="launch"?"receipt":"action-receipt";
    console.log(JSON.stringify(await request(`/api/boards/${id}/coordinator/${endpoint}`,{identity:caller.identity,actionId:action.id,token,receipt})));return;
  }
  if(args[0]==="execute-action"){
    const action=board.actions.find(action=>action.id===option("--action"));
    if(!action || action.phase!=="claimed" || action.actor!==caller.identity)throw new Error("Claim the human action first");
    if(action.kind==="members"){
      const change=await request<{token:string;groupId:string;previous:MemberRef[];members:MemberRef[];coordinatorIdentity:string;previousCoordinator:string}>(`/api/boards/${id}/coordinator/membership-operation`,{identity:caller.identity,actionId:action.id});
      let receipt:Record<string,unknown>;
      try{
        if(change.coordinatorIdentity!==change.previousCoordinator){
          const combined=[...change.members,...change.previous.filter(member=>!change.members.some(next=>next.identity===member.identity))];
          await updateGroupMembers(change.groupId,change.previousCoordinator,combined);
          await callGroupHelper(["take-over","--group",change.groupId,"--actor",change.coordinatorIdentity]);
        }
        receipt=await updateGroupMembers(change.groupId,change.coordinatorIdentity,change.members);
      }catch(error){receipt={error:String(error)};}
      console.log(JSON.stringify(await request(`/api/boards/${id}/coordinator/membership-receipt`,{identity:caller.identity,actionId:action.id,token:change.token,receipt})));return;
    }
    const prepared=await request<{operation:NativeOperation|null;token:string|null;waiting?:string}>(`/api/boards/${id}/coordinator/action-operation`,{identity:caller.identity,actionId:action.id});
    if(!prepared.operation){console.log(JSON.stringify(prepared));return;}
    const receipt=await executeNativeOperation(prepared.operation,caller,{callerTerminal:callerHandle});
    console.log(JSON.stringify(await request(`/api/boards/${id}/coordinator/action-receipt`,{identity:caller.identity,actionId:action.id,token:prepared.token,receipt})));
    if(receipt.phase!=="applied")process.exitCode=1;
    return;
  }
  if(args[0]==="launch"){
    const node=board.nodes.find(node=>node.id===option("--node"));if(!node)throw new Error("Node not found");
    const actionId=option("--action",randomUUID());
    if(node.collaborate){
      console.log(JSON.stringify(await request(`/api/boards/${id}/edit`,{baseRevision:board.revision,actionId,operation:{kind:"component-start",nodeId:node.id,body:"Execute the approved component scope using collaborate."}})));return;
    }
    const permit=await request<LaunchPermit>(`/api/boards/${id}/coordinator/launch`,{identity:caller.identity,actionId,nodeId:node.id,nodeRevision:node.revision});
    if(!permit.caller || permit.caller.identity!==caller.identity || permit.caller.incarnationId!==caller.incarnationId)throw new Error("Launch belongs to a different coordinator incarnation");
    for(let step=0;step<2;step++){
      const operation=await request<{operation:NativeOperation;token:string}>(`/api/boards/${id}/coordinator/operation`,{identity:caller.identity,actionId});
      const receipt=await executeNativeOperation(operation.operation,caller,{callerTerminal:callerHandle});
      const updated=await request<BoardSnapshot>(`/api/boards/${id}/coordinator/receipt`,{identity:caller.identity,actionId,token:operation.token,receipt});
      console.log(JSON.stringify({actionId,operation:operation.operation.kind,receipt,attempt:updated.attempts.find(attempt=>attempt.id===permit.attemptId)}));
      if(receipt.phase!=="applied"){process.exitCode=1;return;}
      if(updated.actions.find(action=>action.id===actionId)?.phase==="applied")return;
    }
    return;
  }
  if(args[0]==="group-init"){
    if(board.members.length<2)throw new Error("Group discussion requires at least two selected sessions");
    let groupId=board.discussionGroupId;
    if(!groupId){
      const root=process.env.ORCA_BOARD_ROOT??join(homedir(),"work-vault","sessions","orca-boards");
      const membersPath=join(root,id,"group-members.json"),topicPath=join(root,id,"group-topic.txt");
      await writeFile(membersPath,JSON.stringify(board.members.map(groupMemberPayload)),{mode:0o600});
      const topic=board.messages.filter(message=>message.author==="human").at(-1)?.body || board.nodes.find(node=>node.kind==="run")!.content.prompt;
      await writeFile(topicPath,topic,{mode:0o600});
      const existingGroup=await callGroupHelper(["find-document","--document",join(root,id,"discussion.md")]);
      const group=existingGroup??await callGroupHelper(["create","--topic-file",topicPath,"--members-file",membersPath,"--actor",caller.identity,"--output",join(root,id,"discussion.md")]);
      groupId=group.id;
      await request(`/api/boards/${id}/coordinator/group`,{identity:caller.identity,actionId:randomUUID(),baseRevision:(await request<BoardSnapshot>(`/api/boards/${id}`)).revision,groupId});
    }
    console.log(JSON.stringify(await callGroupHelper(["attach","--group",groupId,"--actor",caller.identity])));return;
  }
  throw new Error("Unknown boardctl command; use --help");
}
main().catch(error=>{console.error(JSON.stringify({error:String(error.message??error)}));process.exitCode=1;});

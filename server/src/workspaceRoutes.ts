import {Router} from "express";
import {randomUUID} from "node:crypto";
import {join} from "node:path";
import {applying,workspaceKey,assertWorkspaceAvailable} from "./workspaceLease.js";
import type {BoardStore} from "./boardStore.js";
import {BoardConflict} from "./boardStore.js";
import {isRecord,type BoardSnapshot,type FileEdit} from "../../shared/board.js";
import {hasActiveWriter} from "./executionBridge.js";
import {readWorkspaceFile,listWorkspaceFiles,previewWorkspaceDiff,applyWorkspaceEdits} from "./workspaceEdits.js";

function taskWorkspace(board:BoardSnapshot,nodeId:string):string{
 const node=board.nodes.find(node=>node.id===nodeId && node.kind==="task");if(!node)throw new Error("Task not found");
 const attempt=board.attempts.filter(attempt=>attempt.nodeId===nodeId).at(-1);
 if(attempt)return attempt.workspacePath;
 if(node.assignment?.kind==="new-worker")return node.assignment.workspacePath;
 const assignment=node.assignment;
 if(assignment?.kind==="member"){
  const member=board.members.find(member=>member.identity===assignment.identity);if(member)return member.workspacePath;
 }
 throw new Error("Choose a task workspace before opening implementation files");
}
function fail(response:import("express").Response,error:unknown):void{response.status(error instanceof BoardConflict?409:400).json({error:String((error as Error).message??error)});}
export function createWorkspaceRouter(store:BoardStore):Router{
 const router=Router({mergeParams:true});
 router.get("/",async(request,response)=>{try{const board=await store.read(String((request.params as {id:string}).id)),workspace=taskWorkspace(board,String(request.query.node));response.json({workspace,...await listWorkspaceFiles(workspace)});}catch(error){fail(response,error);}});
 router.get("/read",async(request,response)=>{try{const board=await store.read(String((request.params as {id:string}).id));response.json(await readWorkspaceFile(taskWorkspace(board,String(request.query.node)),String(request.query.path)));}catch(error){fail(response,error);}});
 router.post("/preview-diff",async(request,response)=>{try{const board=await store.read(String((request.params as {id:string}).id));response.json({edits:await previewWorkspaceDiff(taskWorkspace(board,request.body.nodeId),request.body.diff)});}catch(error){fail(response,error);}});
 router.post("/stage",async(request,response)=>{
  try{
   const board=await store.read(String((request.params as {id:string}).id)),workspace=taskWorkspace(board,request.body.nodeId);
   const edits=request.body.edits as FileEdit[];
   if(!Array.isArray(edits) || !edits.length)throw new Error("File edits required");
   for(const edit of edits){if(!edit || (typeof edit.content!=="string" && edit.content!==null))throw new Error("Invalid edit");await readWorkspaceFile(workspace,edit.path);}
   const path=await store.artifact(board.id,`file-draft-${randomUUID()}`,JSON.stringify({workspace,edits}));
   const snapshot=await store.update(board.id,request.body.baseRevision,request.body.actionId,current=>{current.actions.push({id:request.body.actionId,kind:"file-draft",baseRevision:current.revision,phase:"applied",actor:"human",nodeId:request.body.nodeId,requestId:null,receiptPath:path,error:null,payload:{workspace}});return current;});
   response.json({snapshot,draftId:request.body.actionId});
  }catch(error){fail(response,error);}
 });
 router.post("/apply",async(request,response)=>{
  let workspace:string|undefined;let acquired=false;
  try{
   const board=await store.read(String((request.params as {id:string}).id));
   const previous=board.actions.find(action=>action.id===request.body.actionId);
   if(previous){response.json({action:previous,snapshot:board});return;}
   const draft=board.actions.find(action=>action.id===request.body.draftId && action.kind==="file-draft");
   if(!draft?.receiptPath || !draft.nodeId)throw new Error("Save the file draft before applying it");
   const staged=JSON.parse(await store.readArtifact(board.id,draft.receiptPath)) as {workspace:string;edits:FileEdit[]};
   workspace=workspaceKey(taskWorkspace(board,draft.nodeId));
   if(workspace!==workspaceKey(staged.workspace))throw new Error("Task workspace changed; reopen files before applying");
   assertWorkspaceAvailable(workspace);applying.add(workspace);acquired=true;
   for(const current of await store.list())if(current.attempts.some(attempt=>workspaceKey(attempt.workspacePath)===workspace && hasActiveWriter(attempt)))throw new Error("An agent is writing this workspace. Send the patch as guidance or stop its attempt before Apply");
   const actionId=request.body.actionId;
   const journalName=`apply-${actionId}`;
   const reserved=await store.update(board.id,request.body.baseRevision,actionId,current=>{current.actions.push({id:actionId,kind:"apply-files",baseRevision:current.revision,phase:"claimed",actor:"human",nodeId:draft.nodeId,requestId:null,receiptPath:journalName,error:null,payload:{draftId:draft.id,workspace}});return current;});
   let outcome:unknown,errorText:string|null=null;
   try{outcome=await applyWorkspaceEdits(workspace,staged.edits,join(store.root,board.id,"artifacts",journalName));}catch(error){errorText=String(error);outcome={error:errorText};}
   let snapshot=reserved;
   for(let retry=0;retry<8;retry++){
    const current=await store.read(board.id);
    try{snapshot=await store.update(board.id,current.revision,`applied-${actionId}`,value=>{const action=value.actions.find(action=>action.id===actionId)!;action.phase=errorText?"failed":"applied";action.error=errorText;action.payload={...(isRecord(action.payload)?action.payload:{}),outcome};return value;});break;}catch(error){if(!(error instanceof BoardConflict))throw error;if(retry===7)throw error;}
   }
   response.json({snapshot,action:snapshot.actions.find(action=>action.id===actionId),outcome});
  }catch(error){fail(response,error);}finally{if(acquired && workspace)applying.delete(workspace);}
 });
 return router;
}

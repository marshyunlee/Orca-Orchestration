import {randomUUID} from 'node:crypto';
import {isRecord,type BoardSnapshot,type MemberRef,type ActionRecord} from '../../shared/board.js';
import {importedHasWriter} from '../../shared/imports.js';
import {verifyGroupMember} from './sessionDiscovery.js';
import type {BoardStore} from './boardStore.js';
import {digestNodeInput,digestValue} from './boardGraph.js';
export const importControlKinds=['guidance','pause','resume','stop-rerun','answer-question','reconcile'] as const;
export function importedActionOwner(action:ActionRecord):string|null{return action.kind==='import-control' && isRecord(action.payload) && isRecord(action.payload.owner)?String(action.payload.owner.identity):null;}
export function hasImportedWork(board:BoardSnapshot,nodeId:string):boolean {
 const work=board.nodes.find(node=>node.id===nodeId)?.imported;
 return Boolean(work && (importedHasWriter(work) || board.actions.some(action=>action.kind==='import-control' && action.nodeId===nodeId && ['queued','claimed','unknown'].includes(action.phase))));
}
export function importedControlPrompt(board:BoardSnapshot,action:ActionRecord):string{
 const payload=action.payload as Record<string,unknown>;
 return [`CLI: ${process.env.ORCA_BOARD_CLI??"boardctl"}. Server: ${process.env.ORCA_BOARD_URL??`http://127.0.0.1:${process.env.PORT??8787}`}. Append --board ${board.id} and --url to every command.`,
  `Existing-work owner request: ${payload.control}. Board ${board.id}; action ${action.id}; node ${action.nodeId}.`,
  `Preserve your current Run, Task, Dispatch, session and original approval scope. This is an addition to ongoing work. At your next safe checkpoint run owner-claim --action ${action.id}.`,
  `Frozen source: ${JSON.stringify(payload.native)}; original question ${payload.messageId??"none"}; node revision ${payload.nodeRevision}. Read the saved node content and the human request: ${payload.body}`,
  'Handle this from your own owner session. Guidance goes to the exact current Dispatch; answers go to the original message. Pause holds your future launches while admitted work settles. Resume only the recorded approved scope.',
  'Stop/rerun requires actual settlement of current work and child writers; preserve pre-existing sessions. Changed inputs create a new Task; unchanged failed attempts use native retry rules. Publish the replacement through a fresh collection summary after native observation.',
  `Use owner-finish --action ${action.id} --stage acknowledged --evidence <receipt or checkpoint> when read. Use --stage applied only after handling, with concrete native receipts or attributed cooperative evidence. Acknowledgment does not imply application or task completion.`,
  'Independent schedulers are cooperative; do not claim enforcement that you have not implemented. Keep checking board actions before future starts. Never borrow another session identity.'].join('\n');
}
export function createImportControls(store:BoardStore,verify:(member:MemberRef)=>Promise<MemberRef>=verifyGroupMember){
 async function owned(boardId:string,actionId:string,identity:string){
  const board=await store.read(boardId),action=board.actions.find(action=>action.id===actionId);
  if(!action || importedActionOwner(action)!==identity || !isRecord(action.payload))throw new Error('This action requires its original owner');
  const owner=action.payload.owner as unknown as MemberRef;const current=board.members.find(member=>member.identity===identity);
  if(!current || current.terminalHandle!==owner.terminalHandle || current.incarnationId!==owner.incarnationId || current.hostId!==owner.hostId)throw new Error('Original owner binding changed');await verify(current);
  const node=board.nodes.find(node=>node.id===action.nodeId && !node.removed);
  if(!node?.imported || node.imported.ownerIdentity!==identity || digestValue(node.imported.native)!==action.payload.nativeDigest)throw new Error('Source task or Dispatch changed; reconcile original action');
  return {board,action,node};
 }
 return {
  async reconcile(boardId:string,actionId:string,identity:string,evidence:string):Promise<BoardSnapshot>{
   const board=await store.read(boardId),action=board.actions.find(action=>action.id===actionId);
   if(!action || importedActionOwner(action)!==identity || !isRecord(action.payload) || typeof evidence!=='string' || !evidence.trim())throw new Error('Original owner and reconciliation evidence required');
   const owner=action.payload.owner as unknown as MemberRef;await verify(owner);
   const path=await store.artifact(boardId,`owner-reconciliation-${randomUUID()}`,JSON.stringify({identity,actionId,evidence,original:action}));
   return store.update(boardId,board.revision,`${actionId}-reconciled`,current=>{const entry=current.actions.find(entry=>entry.id===actionId)!;entry.phase='failed';entry.error=`Reconciled without replay: ${evidence}`;entry.receiptPath=path;return current;});
  },
  async queue(boardId:string,revision:number,actionId:string,nodeId:string,control:string,body:string,messageId?:string):Promise<BoardSnapshot>{
   if(!(importControlKinds as readonly string[]).includes(control) || typeof body!=='string')throw new Error('Invalid owner control');
   return store.update(boardId,revision,actionId,board=>{
    const node=board.nodes.find(node=>node.id===nodeId && !node.removed);if(!node?.imported)throw new Error('Imported task required');
    const owner=board.members.find(member=>member.identity===node.imported!.ownerIdentity && member.terminalHandle===node.imported!.ownerHandle);
    if(!owner)throw new Error('Include the actual controlling owner in this group first');
    if(control==='resume' && JSON.stringify({title:node.title,content:node.content})!==JSON.stringify(node.imported.baseline) && board.acceptedNodeDigests[nodeId]!==digestNodeInput(board,nodeId))throw new Error('Approve the current revision through Preview and Start before owner resume');
    if(control==='answer-question' && !board.messages.some(message=>message.importedNodeId===nodeId && message.nativeMessageId===messageId && !message.answered))throw new Error('Original pending question required');
    if(control==='pause' || control==='stop-rerun')board.pausedNodeIds=[...new Set([...board.pausedNodeIds,nodeId])];
    board.actions.push({id:actionId,kind:'import-control',baseRevision:revision,phase:'queued',actor:'human',nodeId,requestId:null,receiptPath:null,error:null,payload:{body,control,messageId,owner:structuredClone(owner),nodeRevision:node.revision,native:node.imported.native,nativeDigest:digestValue(node.imported.native),delivery:'pending'}});return board;
   });
  },
  async claim(boardId:string,actionId:string,identity:string):Promise<BoardSnapshot>{
   const {board,action,node}=await owned(boardId,actionId,identity);
   if(action.phase==='claimed' && action.actor===identity)return board;
   if(!['queued','unknown'].includes(action.phase))throw new Error('Owner action is not available');
   if(node.revision!==(action.payload as Record<string,unknown>).nodeRevision)throw new Error('Node revision changed; reconcile the saved owner request');
   return store.update(boardId,board.revision,`${actionId}-owner-claim`,current=>{const entry=current.actions.find(entry=>entry.id===actionId)!;entry.phase='claimed';entry.actor=identity;return current;});
  },
  async finish(boardId:string,actionId:string,identity:string,stage:'acknowledged'|'applied',evidence:string):Promise<BoardSnapshot>{
   const {board,action,node}=await owned(boardId,actionId,identity);
   if(action.phase!=='claimed' || action.actor!==identity || !['acknowledged','applied'].includes(stage) || typeof evidence!=='string' || !evidence.trim())throw new Error('Claimed owner action and concrete evidence required');
   const payload=action.payload as Record<string,unknown>;
   if(stage==='applied' && node.revision!==payload.nodeRevision)throw new Error('Node changed during owner action; reconcile the original revision');
   const path=await store.artifact(boardId,`owner-receipt-${randomUUID()}`,JSON.stringify({identity,stage,evidence,nodeRevision:payload.nodeRevision,native:payload.native,recordedAt:new Date().toISOString()}));
   return store.update(boardId,board.revision,`${actionId}-${stage}`,current=>{
    const entry=current.actions.find(entry=>entry.id===actionId)!;entry.receiptPath=path;entry.payload={...(entry.payload as object),ownerStage:stage,ownerEvidence:evidence};
    if(stage==='applied'){
     entry.phase='applied';
     if(payload.control==='resume')current.pausedNodeIds=current.pausedNodeIds.filter(id=>id!==node.id);
     if(payload.control==='answer-question'){const message=current.messages.find(message=>message.nativeMessageId===payload.messageId && message.importedNodeId===node.id);if(message)message.answered=true;}
    }
    return current;
   });
  },
 };
}

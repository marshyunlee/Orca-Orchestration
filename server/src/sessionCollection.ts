import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {isRecord,type BoardSnapshot,type MemberRef} from '../../shared/board.js';
import {validateImportedItem,importedSourceKey,type SessionSummary} from '../../shared/imports.js';
import {BoardConflict,type BoardStore} from './boardStore.js';
import {readSavedSessionContext} from './sessionContext.js';
import {discoverImportedWork,persistImportedItems,mergeImportedDependencies} from './importDiscovery.js';
import {discoverGroupSessions,verifyGroupMember} from './sessionDiscovery.js';
import {mergeImportedWork} from './importMerge.js';
import {digestValue} from './boardGraph.js';
import type {NativeOperation,NativeReceipt} from './orca.js';
export async function changeCollectedBoard(store:BoardStore,id:string,event:string,mutate:(board:BoardSnapshot)=>BoardSnapshot):Promise<BoardSnapshot>{
 for(let retry=0;retry<8;retry++){const board=await store.read(id);try{return await store.update(id,board.revision,event,mutate);}catch(error){if(!(error instanceof BoardConflict))throw error;}}
 throw new Error('Board changed repeatedly; refresh before retrying');
}
const defaultPort={verify:verifyGroupMember,context:readSavedSessionContext,discover:async(members:MemberRef[])=>discoverImportedWork(members,(await discoverGroupSessions()).members)};
export function createSessionCollection(store:BoardStore,port=defaultPort){
 const sameBinding=(a:MemberRef,b:MemberRef)=>a.identity===b.identity && a.incarnationId===b.incarnationId && a.terminalHandle===b.terminalHandle && a.hostId===b.hostId;
 async function verifyCoordinator(board:BoardSnapshot,identity:string){if(identity!==board.coordinatorIdentity)throw new Error('Selected coordinator required');await port.verify(board.members.find(member=>member.identity===identity)!);}
 return {
  async begin(boardId:string):Promise<BoardSnapshot>{
   const before=await store.read(boardId);
   for(const member of before.members){
    if(before.collection.requests.some(request=>sameBinding(request.member,member) && (!request.deliveryId || request.deliveryId===before.deliveryId) && !request.responsePath))continue;
    const requestId=`collection_${randomUUID()}`;
    await changeCollectedBoard(store,boardId,requestId,board=>{
     if(!board.members.some(current=>sameBinding(current,member)) || board.collection.requests.some(request=>sameBinding(request.member,member) && (!request.deliveryId || request.deliveryId===board.deliveryId) && !request.responsePath))return board;
     board.collection.requests.push({id:requestId,member,deliveryId:board.deliveryId,createdAt:new Date().toISOString(),savedPath:null,savedCapturedAt:null,contextError:null,delivery:member.identity===board.coordinatorIdentity?'self':'pending',requestId:null,receiptPath:null,responsePath:null,respondedAt:null});return board;
    });
    const saved=await port.context(member).catch(error=>({available:false,capturedAt:null,references:[],text:'',error:String(error)}));
    const path=await store.artifact(boardId,`context-${randomUUID()}`,JSON.stringify(saved));
    await changeCollectedBoard(store,boardId,`${requestId}-context`,board=>{const request=board.collection.requests.find(request=>request.id===requestId);if(request){request.savedPath=path;request.savedCapturedAt=saved.capturedAt;request.contextError=saved.error;}return board;});
   }
   try{
    const board=await store.read(boardId);if(!board.members.length)return board;
    const discovered=await port.discover(board.members);
    const evidence=await store.artifact(boardId,`native-source-${randomUUID()}`,JSON.stringify(discovered));
    await persistImportedItems(store,board,discovered.items,discovered.tasks);
    return await changeCollectedBoard(store,boardId,`collected-${randomUUID()}`,current=>{
     const items=discovered.items.filter(item=>{const member=board.members.find(member=>member.identity===item.sourceIdentity);return member && current.members.some(candidate=>sameBinding(candidate,member));});
     for(const item of items)item.references.push(evidence);
     mergeImportedWork(current,items);mergeImportedDependencies(current);current.collection.error=null;return current;
    });
   }catch(error){return changeCollectedBoard(store,boardId,`collection-error-${randomUUID()}`,board=>{board.collection.error=String(error);return board;});}
  },
  async prepareDelivery(boardId:string,requestId:string,identity:string):Promise<NativeOperation>{
   const board=await store.read(boardId);await verifyCoordinator(board,identity);
   const request=board.collection.requests.find(request=>request.id===requestId);if(!request || (request.deliveryId && request.deliveryId!==board.deliveryId) || request.delivery!=='pending' || request.responsePath)throw new Error('Summary already admitted; reconcile its original receipt');
   if(!board.members.some(member=>sameBinding(member,request.member)))throw new Error('Summary member binding changed');await port.verify(request.member);
   const url=process.env.ORCA_BOARD_URL??`http://127.0.0.1:${process.env.PORT??8787}`;
   const runtime=process.env.ORCA_BOARD_RUNTIME??join(homedir(),'.local/state/orca-board');
   const body=[`At your next safe checkpoint, contribute a bounded summary to existing-session board ${board.id}. This adds visibility to your current work; preserve your task, Run, session, mailbox and approval scope. Do not call group-init or create a Dispatch for this request.`,
    `CLI: ${process.env.ORCA_BOARD_CLI??'boardctl'} collection-publish --board ${board.id} --request ${request.id} --file <summary.json> --terminal ${request.member.terminalHandle} --url ${url} --token-file ${join(runtime,`token-${new URL(url).port||80}`)}.`,
    `Write summary JSON under ${join(store.root,board.id,'artifacts')}. Run boardctl --help for its exact schema. Include goals, acceptedScope, blockers, documents and items with stable itemId, title, content, status, references and dependencies. Narrative native is null; use only observed native identities. Preserve stable item IDs on later refreshes. Your sourceIdentity is ${request.member.identity}.`,
    'Reply when safe. An enqueue receipt is not a response or evidence of completion.'].join('\n');
   const operation:NativeOperation={kind:'send-summary',terminalHandle:request.member.terminalHandle,body};
   await changeCollectedBoard(store,boardId,`${requestId}-sending`,current=>{const entry=current.collection.requests.find(entry=>entry.id===requestId)!;if(entry.delivery!=='pending')throw new Error('Summary delivery already began');entry.delivery='sending';return current;});
   await store.artifact(boardId,`${requestId}-operation`,JSON.stringify(operation));return operation;
  },
  async recordDelivery(boardId:string,requestId:string,identity:string,receipt:Pick<NativeReceipt,'phase'|'requestId'|'raw'|'error'>):Promise<BoardSnapshot>{
   const board=await store.read(boardId);await verifyCoordinator(board,identity);
   const request=board.collection.requests.find(request=>request.id===requestId);if(!request || !['sending','unknown'].includes(request.delivery))throw new Error('No admitted summary delivery');
   const path=await store.artifact(boardId,`collection-receipt-${randomUUID()}`,JSON.stringify(receipt));
   return changeCollectedBoard(store,boardId,`collection-delivered-${randomUUID()}`,current=>{const entry=current.collection.requests.find(entry=>entry.id===requestId)!;entry.delivery=receipt.phase==='applied'?'sent':'unknown';entry.requestId=receipt.requestId??entry.requestId;entry.receiptPath=path;return current;});
  },
  async publish(boardId:string,requestId:string,identity:string,summary:SessionSummary):Promise<BoardSnapshot>{
   const before=await store.read(boardId),request=before.collection.requests.find(request=>request.id===requestId);
   if(!request || request.member.identity!==identity)throw new Error('Only the requested member can publish its summary');
   await port.verify(request.member);
   if(!isRecord(summary) || ['goals','acceptedScope','blockers'].some(field=>typeof summary[field]!=='string') || !Array.isArray(summary.items) || !Array.isArray(summary.documents) || summary.documents.some(value=>typeof value!=='string'))throw new Error('Invalid session summary');
   for(const item of summary.items){validateImportedItem(item);if(item.sourceIdentity!==identity)throw new Error('Summary attribution must match its author');if(!item.native && (item.ownerIdentity!==identity || item.ownerHandle!==request.member.terminalHandle))throw new Error('Narrative work belongs to its reporting session');}
   if(request.responsePath){if(await store.readArtifact(boardId,request.responsePath)!==JSON.stringify(summary))throw new Error('Summary already published; request a fresh collection');return before;}
   const results=new Map<string,string>();
   for(const item of summary.items)if(!item.native && item.status==='completed' && item.result?.trim())results.set(item.itemId,await store.artifact(boardId,`reported-result-${randomUUID()}`,JSON.stringify({author:identity,result:item.result,references:item.references,observedAt:item.observedAt})));
   const path=await store.artifact(boardId,`summary-${randomUUID()}`,JSON.stringify(summary));
   return changeCollectedBoard(store,boardId,`${requestId}-response`,board=>{
    const entry=board.collection.requests.find(entry=>entry.id===requestId)!;entry.responsePath=path;entry.respondedAt=new Date().toISOString();
    if((entry.deliveryId && entry.deliveryId!==board.deliveryId) || !board.members.some(member=>sameBinding(member,entry.member)))return board;
    const items=summary.items.map(item=>{
     if(!item.native)return {...item,workspacePath:request.member.workspacePath,resultPath:results.get(item.itemId)??null,references:[...item.references,path]};
     const existing=board.nodes.find(node=>node.imported?.key===importedSourceKey(item))?.imported;
     if(!existing || !existing.sourceIdentities.includes(identity))throw new Error('Native work requires observed source association');
     return {...item,native:existing.native,ownerIdentity:existing.ownerIdentity,ownerHandle:existing.ownerHandle,status:existing.status,resultPath:existing.resultPath,references:[...item.references,path]};
    });
    mergeImportedWork(board,items);
    board.messages.push({id:`summary_${digestValue(requestId)}`,author:identity,createdAt:entry.respondedAt,body:`Goals: ${summary.goals}\nAccepted scope: ${summary.acceptedScope}\nBlockers: ${summary.blockers}\nDocuments: ${summary.documents.join(', ')}\nSource: ${path}`});return board;
   });
  },
 };
}

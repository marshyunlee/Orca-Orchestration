import {randomUUID} from "node:crypto";
import type {BoardStore} from "./boardStore.js";
import {isRecord,validateMembers,type MemberRef} from "../../shared/board.js";
import {hasActiveWriter} from "./executionBridge.js";
import {verifyGroupMember} from "./sessionDiscovery.js";
export function createMembershipActions(store:BoardStore){return {
 async begin(boardId:string,actionId:string,identity:string){
  const board=await store.read(boardId),action=board.actions.find(action=>action.id===actionId);
  if(!action || action.kind!=="members" || action.phase!=="claimed" || identity!==board.coordinatorIdentity || !isRecord(action.payload) || !isRecord(action.payload.data))throw new Error("Claim this membership action first");
  const desired=action.payload.data;validateMembers(desired.members);
  if(typeof desired.coordinatorIdentity!=="string" || !desired.members.some(member=>member.identity===desired.coordinatorIdentity))throw new Error("Coordinator must remain a member");
  if(action.payload.membershipToken)throw new Error("Membership change already admitted; inspect the shared group before retrying");
  const members=await Promise.all(desired.members.map(verifyGroupMember));
  const removed=board.members.filter(member=>!members.some(candidate=>candidate.identity===member.identity && candidate.incarnationId===member.incarnationId && candidate.terminalHandle===member.terminalHandle));
  if(board.attempts.some(attempt=>hasActiveWriter(attempt) && (desired.coordinatorIdentity!==board.coordinatorIdentity || removed.some(member=>member.terminalHandle===attempt.assigneeHandle))))throw new Error("Settle outstanding work before this membership change");
  if(desired.coordinatorIdentity!==board.coordinatorIdentity && board.actions.some(other=>other.id!==actionId && ["claimed","unknown"].includes(other.phase)))throw new Error("Reconcile outstanding control actions before coordinator handover");
  const token=randomUUID();
  await store.update(boardId,board.revision,`membership-${token}`,current=>{const currentAction=current.actions.find(action=>action.id===actionId)!;currentAction.payload={...(currentAction.payload as object),membershipToken:token,desiredMembers:members};return current;});
  return {token,groupId:board.discussionGroupId,previous:board.members,members,coordinatorIdentity:desired.coordinatorIdentity,previousCoordinator:board.coordinatorIdentity};
 },
 async finish(boardId:string,actionId:string,identity:string,token:string,receipt:Record<string,unknown>){
  const board=await store.read(boardId),action=board.actions.find(action=>action.id===actionId);
  if(identity!==board.coordinatorIdentity || !action || !isRecord(action.payload) || action.payload.membershipToken!==token || !isRecord(action.payload.data))throw new Error("Membership receipt does not match its admitted action");
  const members=action.payload.desiredMembers as MemberRef[],desired=action.payload.data;
  const path=await store.artifact(boardId,`membership-receipt-${randomUUID()}`,JSON.stringify(receipt));
  return store.update(boardId,board.revision,`membership-receipt-${token}`,current=>{
   const target=current.actions.find(item=>item.id===actionId)!;target.receiptPath=path;
   if(receipt.error || !Array.isArray(receipt.members) || receipt.coordinator!==desired.coordinatorIdentity){target.phase="unknown";target.error=String(receipt.error??"Membership outcome needs reconciliation");return current;}
   const identities=receipt.members.map(member=>isRecord(member)?member.identity:null).sort();
   if(JSON.stringify(identities)!==JSON.stringify(members.map(member=>member.identity).sort()))throw new Error("Shared group membership differs from the approved selection");
   const previous=current.coordinatorIdentity;current.members=members;current.coordinatorIdentity=String(desired.coordinatorIdentity);target.phase="applied";
   if(previous!==current.coordinatorIdentity){
    current.actions.push({id:`handover_${randomUUID()}`,kind:"handover",baseRevision:current.revision,phase:"queued",actor:"human",nodeId:null,requestId:null,receiptPath:null,error:null,payload:{delivery:"pending",body:"Complete the explicitly requested coordinator handover.",remainingRunIds:[...new Set([receipt.run_id,current.implementationRunId].filter(value=>typeof value==="string"))]}});
   }
   return current;
  });
 },
};}

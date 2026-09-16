import {isRecord, assertText, validateContent, type MemberRef, type NodeContent} from './board.js';
export interface NativeSource {hostId:string;runId:string;taskId:string;dispatchId:string|null}
export interface ImportedItem {
 itemId:string;sourceIdentity:string;ownerIdentity:string|null;ownerHandle:string|null;
 native:NativeSource|null;title:string;content:NodeContent;status:string;observedAt:string;
 references:string[];dependencies:string[];resultPath:string|null;result?:string;workspacePath?:string;
}
export interface ImportedWork extends ImportedItem {
 key:string;sourceIdentities:string[];baseline:{title:string;content:NodeContent};
 proposals:Partial<Record<keyof NodeContent|'title',string>>;
 resultRevision?:number;resultDigest?:string;
}
export interface CollectionRequest {
 id:string;member:MemberRef;createdAt:string;savedPath:string|null;savedCapturedAt:string|null;
 contextError:string|null;delivery:'pending'|'sending'|'sent'|'unknown'|'self';
 requestId:string|null;receiptPath:string|null;responsePath:string|null;respondedAt:string|null;
}
export interface CollectionState {requests:CollectionRequest[];error:string|null;suppressedEdges:string[]}
export interface SessionSummary {
 goals:string;acceptedScope:string;blockers:string;documents:string[];items:ImportedItem[];
}
export function emptyCollection():CollectionState{return {requests:[],error:null,suppressedEdges:[]};}
export function validateImportedItem(value:unknown):asserts value is ImportedItem {
 if(!isRecord(value))throw new Error('Imported item required');
 for(const field of ['itemId','sourceIdentity','title','status','observedAt'])assertText(value[field],field);
 if(!value.itemId || !value.sourceIdentity || !value.title)throw new Error('Source item identity and title required');
 for(const field of ['ownerIdentity','ownerHandle','resultPath'])if(value[field]!==null)assertText(value[field],field);
 validateContent(value.content);
 if(value.result!==undefined)assertText(value.result,"result");
 if(value.workspacePath!==undefined){assertText(value.workspacePath,"workspacePath");if(!value.workspacePath.startsWith("/"))throw new Error("Absolute source workspace required");}
 for(const field of ['references','dependencies'])if(!Array.isArray(value[field]) || (value[field] as unknown[]).some(item=>typeof item!=='string'))throw new Error(`${field} must be text array`);
 if(value.native!==null){
  if(!isRecord(value.native))throw new Error('Invalid native identity');
  for(const field of ['hostId','runId','taskId']){assertText(value.native[field],field);if(!value.native[field])throw new Error(`Native ${field} required`);}
  if(value.native.dispatchId!==null)assertText(value.native.dispatchId,'dispatchId');
 }
}
export function importedSourceKey(item:ImportedItem):string {
 return item.native?JSON.stringify(['native',item.native.hostId,item.native.runId,item.native.taskId]):JSON.stringify(['narrative',item.sourceIdentity,item.itemId]);
}
export function importedHasWriter(work:ImportedWork):boolean {return ['dispatched','running','active','unknown'].includes(work.status);}

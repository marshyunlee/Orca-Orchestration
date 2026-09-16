import type { BoardSnapshot } from "../../shared/board.js";
export interface BoardViewState {
  selectedBoardId: string | null; selectedNodeId: string | null;
  snapshotsById: Record<string,BoardSnapshot>; drafts: Record<string,string>;
  draftRevisions: Record<string,number>; latestRequestByBoard: Record<string,number>;
  errors: Record<string,string>;
}
export type BoardViewEvent =
  | { type:"select"; boardId:string | null }
  | { type:"select-node"; nodeId:string | null }
  | { type:"load-started"; boardId:string; requestSequence:number }
  | { type:"load-succeeded"; boardId:string; requestSequence:number; snapshot:BoardSnapshot }
  | { type:"edit-draft"; boardId:string; nodeId:string; section:string; value:string }
  | { type:"reconcile-draft"; boardId:string; nodeId:string; revision:number }
  | { type:"discard-drafts"; boardId:string; nodeId:string }
  | { type:"save-succeeded"; boardId:string; snapshot:BoardSnapshot; savedDrafts:Record<string,string> }
  | { type:"save-conflicted"; boardId:string; error:string };
export function createBoardViewState(): BoardViewState {
  return {selectedBoardId:null,selectedNodeId:null,snapshotsById:{},drafts:{},draftRevisions:{},latestRequestByBoard:{},errors:{}};
}
export function reduceBoardView(state:BoardViewState,event:BoardViewEvent): BoardViewState {
  switch(event.type) {
    case "select": return {...state,selectedBoardId:event.boardId,selectedNodeId:null};
    case "select-node": return {...state,selectedNodeId:event.nodeId};
    case "load-started": return {...state,latestRequestByBoard:{...state.latestRequestByBoard,[event.boardId]:event.requestSequence}};
    case "load-succeeded": {
      if(event.requestSequence<(state.latestRequestByBoard[event.boardId]??0) || event.snapshot.revision<(state.snapshotsById[event.boardId]?.revision??0)) return state;
      return {...state,snapshotsById:{...state.snapshotsById,[event.boardId]:event.snapshot}};
    }
    case "edit-draft": {
      const key=`${event.boardId}/${event.nodeId}`;
      return {...state,drafts:{...state.drafts,[`${key}/${event.section}`]:event.value},draftRevisions:{...state.draftRevisions,[key]:state.draftRevisions[key]??state.snapshotsById[event.boardId]?.nodes.find(node=>node.id===event.nodeId)?.revision??1}};
    }
    case "reconcile-draft": return {...state,draftRevisions:{...state.draftRevisions,[`${event.boardId}/${event.nodeId}`]:event.revision},errors:{...state.errors,[event.boardId]:""}};
    case "discard-drafts": {
      const drafts={...state.drafts},draftRevisions={...state.draftRevisions};
      for(const key of Object.keys(drafts)) if(key.startsWith(`${event.boardId}/${event.nodeId}/`)) delete drafts[key];
      delete draftRevisions[`${event.boardId}/${event.nodeId}`];
      return {...state,drafts,draftRevisions};
    }
    case "save-succeeded": {
      const drafts={...state.drafts},draftRevisions={...state.draftRevisions};
      for(const [key,value] of Object.entries(event.savedDrafts)) if(drafts[key]===value) delete drafts[key];
      for(const key of Object.keys(draftRevisions)) if(!Object.keys(drafts).some(draft=>draft.startsWith(key+"/"))) delete draftRevisions[key];
      const current=state.snapshotsById[event.boardId];
      return {...state,drafts,draftRevisions,snapshotsById:{...state.snapshotsById,[event.boardId]:current && current.revision>event.snapshot.revision?current:event.snapshot},errors:{...state.errors,[event.boardId]:""}};
    }
    case "save-conflicted": return {...state,errors:{...state.errors,[event.boardId]:event.error}};
  }
}

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { BoardStore } from "./boardStore.js";
import { BoardConflict } from "./boardStore.js";
import { digestExecutableBoard, digestSpec, digestNodeInput, validateGraph } from "./boardGraph.js";
import { createBoardNode, isRecord, validateContent, validateAssignment, type BoardSnapshot, type MemberRef, type BoardMessage, type BoardNode, type BoardEdge } from "../../shared/board.js";
import { verifyGroupMember } from "./sessionDiscovery.js";
import { runOrca } from "./orca.js";

export type CoordinatorProposal =
  | {kind:"spec";text:string;messages:BoardMessage[]}
  | {kind:"graph";nodes:BoardNode[];edges:BoardEdge[]}
  | {kind:"preview";text:string;specDigest:string;graphDigest:string;images?:{mimeType:string;base64:string;caption:string}[]};
export interface CoordinatorPort {
  verify(member:MemberRef):Promise<MemberRef>;
  send(member:MemberRef,prompt:string):Promise<unknown>;
}
export const coordinatorPort:CoordinatorPort={verify:verifyGroupMember,send:(member,prompt)=>runOrca(["terminal","send","--terminal",member.terminalHandle,"--text",prompt,"--enter","--wait-submit","1"])};
export function createCoordinatorActions(store:BoardStore,port:CoordinatorPort=coordinatorPort) {
  const delivering=new Set<string>();
  async function changeLatest(boardId:string,actionId:string,mutate:(board:BoardSnapshot)=>BoardSnapshot) {
    for(let retry=0;retry<8;retry++){
      const board=await store.read(boardId);
      try{return await store.update(boardId,board.revision,actionId,mutate);}catch(error){if(!(error instanceof BoardConflict))throw error;}
    }
    throw new Error("Board is changing; receipt remains available for reconciliation");
  }
  return {
    async queue(boardId:string,baseRevision:number,actionId:string,kind:string,body:string,payload:unknown=null):Promise<BoardSnapshot>{
      if(!["discuss","generate-tasks","review-graph","answer-question","members","start","resume","guidance","stop-rerun","reconcile"].includes(kind) || typeof body!=="string")throw new Error("Unsupported coordinator action");
      return store.update(boardId,baseRevision,actionId,board=>{
        if(!board.coordinatorIdentity || !board.members.some(member=>member.identity===board.coordinatorIdentity))throw new Error("Select the group coordinator first");
        if(kind==="discuss" && board.members.length<2)throw new Error("Select at least two group sessions for discussion");
        if(kind==="generate-tasks" && (!board.specApproval || board.specApproval.digest!==digestSpec(board)))throw new Error("Approve the current specification first");
        if(kind==="start" || kind==="resume"){
          if(!board.specApproval || board.specApproval.digest!==digestSpec(board))throw new Error("Approve the current specification first");
          if(!board.preview || board.preview.specDigest!==digestSpec(board) || board.preview.graphDigest!==digestExecutableBoard(board))throw new Error("Preview is out of date; update it before Start");
          board.acceptedGraphDigest=digestExecutableBoard(board);board.acceptedNodeDigests=Object.fromEntries(board.nodes.filter(node=>node.kind==="task" && !node.removed).map(node=>[node.id,digestNodeInput(board,node.id)]));board.pauseNewStarts=false;if(kind==="resume")board.pausedNodeIds=[];
        }
        board.actions.push({id:actionId,kind,baseRevision,phase:"queued",actor:"human",nodeId:isRecord(payload)&&typeof payload.nodeId==="string"?payload.nodeId:null,requestId:null,receiptPath:null,error:null,payload:{body,data:payload,delivery:"pending"}});
        if(body)board.messages.push({id:randomUUID(),author:"human",body,createdAt:new Date().toISOString()});
        return board;
      });
    },
    async deliver(boardId:string,actionId:string):Promise<void>{
      const key=`${boardId}/${actionId}`;if(delivering.has(key))return;delivering.add(key);
      try {
        const board=await store.read(boardId),action=board.actions.find(action=>action.id===actionId);
        if(!action || action.phase!=="queued" || !isRecord(action.payload) || action.payload.delivery!=="pending")return;
        const member=board.members.find(member=>member.identity===board.coordinatorIdentity)!;
        await port.verify(member);
        const command=process.env.ORCA_BOARD_CLI ?? "boardctl";
        const prompt=[
          `Orca group board request: ${action.kind}. Board ${boardId}; action ${actionId}.`,
          `Run boardctl from this coordinator session. Inspect the board, claim this action once, then read the returned revision before publishing.`,
          `CLI: ${command}. Server: ${process.env.ORCA_BOARD_URL??`http://127.0.0.1:${process.env.PORT??8787}`}. Use its --help for typed commands.`,
          `Board artifacts: ${join(store.root,boardId)}. Keep all discussion and evidence here.`,
          `For discuss: initialize/attach the shared group via boardctl group-init; follow the group skill's finite rounds, collect attributed contributions, publish its canonical document, and propose the resulting spec. Do not infer agreement from silence.`,
          `For generate-tasks: propose task nodes, exact group-member or new-worker assignments, and edges from the Run root using the approved spec.`,
          `For review-graph: inspect current spec, graph, assignments, results; publish an expected-deliverable Preview with examples, behavior, acceptance criteria, and open assumptions. Do not execute tasks to create Preview.`,
          `For start or resume: execute the claimed action, then supervise through boardctl launch; choose ready waves and process native questions/results. Publish questions and exact attempt observations to the board. Do not use raw native starts for board-owned tasks. If starts are paused, leave active work running and idle after recording its outcomes; a new human action will wake you.`,
          `For guidance, stop-rerun, answer-question, members, handover, or reconcile: use boardctl execute-action. Preserve existing group sessions. After cooperative stop, wait for the member acknowledgment and execute the stop action again; launch the revised node only after rerunReady. Process queued human actions during your supervision loop, not only terminal prompts.`,
          `For unknown outcomes, use boardctl reconcile --action <original-action-id>. Inspect the exact persisted operation and native request; never invent success or resend without its original request ID.`,
          `Never inject yourself as a worker. A coordinator handover is an explicit human decision. Preserve the user's edits; reconcile stale proposals.`,
          `User request: ${String(action.payload.body??"")}`,
        ].join("\n");
        await changeLatest(boardId,`${actionId}-sending-${randomUUID()}`,current=>{const item=current.actions.find(item=>item.id===actionId)!;if(!isRecord(item.payload)||item.payload.delivery!=="pending")throw new Error("Action delivery already began");item.payload={...item.payload,delivery:"sending"};return current;});
        let receipt:unknown;
        try { receipt=await port.send(member,prompt); }
        catch(error){await changeLatest(boardId,`${actionId}-delivery-unknown`,current=>{const item=current.actions.find(item=>item.id===actionId)!;item.phase="unknown";item.error=String(error);return current;});return;}
        const receiptPath=await store.artifact(boardId,`delivery-${actionId}`,JSON.stringify(receipt));
        await changeLatest(boardId,`${actionId}-delivered`,current=>{
          const item=current.actions.find(item=>item.id===actionId)!;
          item.receiptPath=receiptPath;
          item.requestId=isRecord(receipt)&&isRecord(receipt.mutation)&&typeof receipt.mutation.requestId==="string"?receipt.mutation.requestId:null;
          item.payload={...(isRecord(item.payload)?item.payload:{}),delivery:"accepted"};return current;
        });
      }finally{delivering.delete(key);}
    },
    async claim(boardId:string,actionId:string,identity:string):Promise<BoardSnapshot>{
      const board=await store.read(boardId);
      if(identity!==board.coordinatorIdentity)throw new Error("Only the selected coordinator may claim this action");
      await port.verify(board.members.find(member=>member.identity===identity)!);
      return store.update(boardId,board.revision,`${actionId}-claim`,current=>{
        const action=current.actions.find(action=>action.id===actionId);
        if(!action || (action.phase!=="queued" && !(action.phase==="unknown" && isRecord(action.payload) && !action.payload.operationToken && !action.payload.effectToken && !action.payload.membershipToken)))throw new Error("Action is not available to claim; inspect its receipt");
        action.phase="claimed";action.actor=identity;return current;
      });
    },
    async publish(boardId:string,baseRevision:number,actionId:string,identity:string,proposal:CoordinatorProposal):Promise<BoardSnapshot>{
      if(!isRecord(proposal))throw new Error("Proposal required");
      const images:{artifactPath:string;caption:string}[]=[];
      if(proposal.kind==="preview" && proposal.images){
        if(!Array.isArray(proposal.images) || proposal.images.length>8)throw new Error("Preview supports up to eight images");
        for(const image of proposal.images){
          if(!image || !["image/png","image/jpeg","image/webp","image/gif"].includes(image.mimeType) || typeof image.base64!=="string" || typeof image.caption!=="string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(image.base64) || Buffer.from(image.base64,"base64").length>1024*1024)throw new Error("Preview images must be PNG, JPEG, WebP or GIF up to 1 MB");
          images.push({artifactPath:await store.artifact(boardId,`preview-image-${randomUUID()}`,JSON.stringify(image)),caption:image.caption});
        }
      }
      const proposalPath=await store.artifact(boardId,`proposal-${randomUUID()}`,JSON.stringify(proposal));
      try {
        return await store.update(boardId,baseRevision,`${actionId}-publish`,board=>{
          const action=board.actions.find(action=>action.id===actionId);
          if(identity!==board.coordinatorIdentity || !action || action.phase!=="claimed" || action.actor!==identity)throw new Error("Proposal requires this coordinator's claimed action");
          const root=board.nodes.find(node=>node.kind==="run")!;
          switch(proposal.kind){
            case "spec":
              if(action.kind!=="discuss" || typeof proposal.text!=="string" || !proposal.text.trim() || !Array.isArray(proposal.messages))throw new Error("Discussion specification required");
              for(const message of proposal.messages){if(!message || typeof message.body!=="string" || !board.members.some(member=>member.identity===message.author))throw new Error("Contribution author must be an identified group member");board.messages.push({...message,id:randomUUID(),createdAt:new Date().toISOString()});}
              root.content.design=proposal.text;root.revision++;board.specApproval=null;break;
            case "graph": {
              if(action.kind!=="generate-tasks" || !board.specApproval || board.specApproval.digest!==digestSpec(board) || !Array.isArray(proposal.nodes) || !Array.isArray(proposal.edges))throw new Error("Approved specification and task graph required");
              for(const node of proposal.nodes){if(node.kind!=="task")throw new Error("Graph proposals contain task nodes only");validateContent(node.content);validateAssignment(node.assignment);}
              const newIds=new Set(proposal.nodes.map(node=>node.id));
              for(const old of board.nodes.filter(node=>node.kind==="task")){
                const replacement=proposal.nodes.find(node=>node.id===old.id);
                const changed=!replacement || JSON.stringify([replacement.title,replacement.content,replacement.assignment,proposal.edges.filter(edge=>edge.target===old.id).map(edge=>edge.source).sort()])!==JSON.stringify([old.title,old.content,old.assignment,board.edges.filter(edge=>edge.target===old.id).map(edge=>edge.source).sort()]);
                if(board.attempts.some(attempt=>attempt.nodeId===old.id && ["admitted","ready","dispatched","unknown"].includes(attempt.nativeStatus)) && changed)throw new Error("Reconcile active task edits through intervention controls");
              }
              board.nodes=[...board.nodes.filter(node=>node.kind!=="task" || !newIds.has(node.id)).map(node=>node.kind==="task"?{...node,removed:true}:node),...proposal.nodes.map(node=>({...node,removed:false,revision:(()=>{const old=board.nodes.find(old=>old.id===node.id);return old && JSON.stringify([old.title,old.content,old.assignment])===JSON.stringify([node.title,node.content,node.assignment])?old.revision:(old?.revision??0)+1;})()}))];
              board.edges=proposal.edges;validateGraph(board.nodes,board.edges);break;
            }
            case "preview": {
              if(proposal.specDigest!==digestSpec(board) || proposal.graphDigest!==digestExecutableBoard(board))throw new Error("Preview refers to a stale specification or graph");
              if(action.kind!=="review-graph" || typeof proposal.text!=="string" || !proposal.text.trim())throw new Error("Graph review Preview required");
              let preview=board.nodes.find(node=>node.kind==="preview");
              if(!preview){preview=createBoardNode(`preview_${randomUUID()}`,"preview","Preview");preview.position={x:750,y:100};board.nodes.push(preview);}
              preview.content.design=proposal.text;preview.revision++;
              board.preview={nodeId:preview.id,specDigest:proposal.specDigest,graphDigest:proposal.graphDigest,contentPath:proposalPath,generatedBy:identity,current:true,images};
              board.edges=board.edges.filter(edge=>edge.target!==preview!.id);
              const tasks=board.nodes.filter(node=>node.kind==="task" && !node.removed);
              for(const node of tasks.filter(node=>!board.edges.some(edge=>edge.source===node.id)))board.edges.push({id:`edge_${randomUUID()}`,source:node.id,target:preview.id});
              break;
            }
            default:throw new Error("Unknown proposal kind");
          }
          action.phase="applied";action.receiptPath=proposalPath;action.error=null;return board;
        });
      }catch(error){
        if(error instanceof BoardConflict)await changeLatest(boardId,`conflict-${randomUUID()}`,board=>{const action=board.actions.find(action=>action.id===actionId);if(action){action.error=`Stale proposal retained at ${proposalPath}; reconcile with current human edits`;action.payload={...(isRecord(action.payload)?action.payload:{}),conflictProposal:proposalPath};}return board;});
        throw error;
      }
    },
  };
}

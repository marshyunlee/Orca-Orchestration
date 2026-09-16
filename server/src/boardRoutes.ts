import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { createBoardNode, isRecord, validateContent, validateAssignment, type BoardSnapshot, type BoardEdit } from "../../shared/board.js";
import { BoardConflict, type BoardStore } from "./boardStore.js";
import { findDownstream, digestSpec } from "./boardGraph.js";
import { requireToken } from "./localAuth.js";

export function applyBoardEdit(board: BoardSnapshot, operation: BoardEdit): BoardSnapshot {
  if (!isRecord(operation)) throw new Error("Operation required");
  const target = "nodeId" in operation ? board.nodes.find(node=>node.id===operation.nodeId && !node.removed) : undefined;
  if ("nodeId" in operation && !target) throw new Error("Node not found");
  switch (operation.kind) {
    case "add-task": {
      if (typeof operation.title !== "string" || !operation.title.trim()) throw new Error("Task title required");
      const node = createBoardNode(`node_${randomUUID()}`,"task",operation.title);
      node.position={x:400,y:100+board.nodes.filter(node=>!node.removed).length*130};
      board.nodes.push(node);
      board.edges.push({id:`edge_${randomUUID()}`,source:board.nodes.find(node=>node.kind==="run")!.id,target:node.id});
      return board;
    }
    case "move-node":
      if (!Number.isFinite(operation.position?.x) || !Number.isFinite(operation.position?.y)) throw new Error("Invalid position");
      target!.position=operation.position; return board;
    case "edit-node": {
      validateContent(operation.content); validateAssignment(operation.assignment);
      if (typeof operation.title !== "string" || !operation.title.trim()) throw new Error("Title required");
      if (target!.kind === "preview") throw new Error("Update Preview through graph review");
      const assignment=operation.assignment;
      if (assignment?.kind === "member" && !board.members.some(member=>member.identity===assignment.identity)) throw new Error("Assigned session is not a member");
      if (JSON.stringify([target!.title,target!.content,target!.assignment]) === JSON.stringify([operation.title,operation.content,operation.assignment])) return board;
      target!.title=operation.title; target!.content=operation.content; target!.assignment=operation.assignment; target!.revision++;
      if (target!.kind === "run") board.specApproval=null;
      if (board.attempts.some(attempt=>attempt.nodeId===target!.id && ["admitted","ready","dispatched","unknown"].includes(attempt.nativeStatus))) {
        board.pausedNodeIds=[...new Set([...board.pausedNodeIds,...findDownstream(target!.id,board.edges)])];
      }
      return board;
    }
    case "connect":
      if (typeof operation.source!=="string" || typeof operation.target!=="string") throw new Error("Edge endpoints required");
      if (board.edges.some(edge=>edge.source===operation.source && edge.target===operation.target)) return board;
      board.edges.push({id:`edge_${randomUUID()}`,source:operation.source,target:operation.target}); return board;
    case "disconnect": {
      if (!board.edges.some(edge=>edge.id===operation.edgeId)) throw new Error("Edge not found");
      board.edges=board.edges.filter(edge=>edge.id!==operation.edgeId); return board;
    }
    case "remove-node":
      if (target!.kind!=="task") throw new Error("Only task nodes can be removed");
      if (board.attempts.some(attempt=>attempt.nodeId===target!.id && ["admitted","ready","dispatched","unknown"].includes(attempt.nativeStatus))) throw new Error("Stop active work before removing this task");
      board.pausedNodeIds=[...new Set([...board.pausedNodeIds,...findDownstream(target!.id,board.edges)])];
      target!.removed=true;
      board.edges=board.edges.filter(edge=>edge.source!==target!.id && edge.target!==target!.id); return board;
    case "approve-spec": {
      const root=board.nodes.find(node=>node.kind==="run")!;
      if (!root.content.design.trim()) throw new Error("A specification is required before approval");
      board.specApproval={nodeRevision:root.revision,digest:digestSpec(board)}; return board;
    }
    case "pause":
      if (operation.nodeIds) {
        if (!Array.isArray(operation.nodeIds) || operation.nodeIds.some(id=>!board.nodes.some(node=>node.id===id))) throw new Error("Unknown pause scope");
        board.pausedNodeIds=[...new Set([...board.pausedNodeIds,...operation.nodeIds])];
      } else board.pauseNewStarts=true;
      return board;
    case "resume":
      if (!board.acceptedGraphDigest) throw new Error("Start the reviewed board before resuming");
      board.pauseNewStarts=false;
      board.pausedNodeIds=operation.nodeIds ? board.pausedNodeIds.filter(id=>!operation.nodeIds!.includes(id)) : []; return board;
    default: throw new Error("Unsupported board edit");
  }
}

export function sendBoardError(response: Response, error: unknown): void {
  if (error instanceof BoardConflict) response.status(409).json({error:error.message,currentRevision:error.currentRevision});
  else response.status((error as NodeJS.ErrnoException).code === "ENOENT" ? 404 : 400).json({error:String((error as Error).message ?? error)});
}
export function createBoardRouter(store: BoardStore, token: string): Router {
  const router=Router();
  router.get("/",async (_request,response)=>{try{response.json({boards:await store.list()});}catch(error){sendBoardError(response,error);}});
  router.get("/:id",async (request,response)=>{try{response.json(await store.read(request.params.id));}catch(error){sendBoardError(response,error);}});
  router.use(requireToken(token));
  router.post("/",async (request,response)=>{
    try { response.json(await store.create(request.body,request.body.actionId)); } catch(error){sendBoardError(response,error);}
  });
  router.post("/:id/edit",async (request: Request,response: Response)=>{
    try {
      if (!isRecord(request.body) || !Number.isInteger(request.body.baseRevision)) throw new Error("Base revision required");
      const {baseRevision,actionId,operation}=request.body;
      response.json(await store.update(String(request.params.id),baseRevision as number,actionId as string,board=>applyBoardEdit(board,operation as BoardEdit)));
    } catch(error){sendBoardError(response,error);}
  });
  router.get("/:id/artifacts/:name",async(request,response)=>{
    try { response.type("text/plain").send(await store.readArtifact(request.params.id,request.params.name)); } catch(error){sendBoardError(response,error);}
  });
  return router;
}

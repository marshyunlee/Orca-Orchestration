import { Router } from 'express';
import type { BoardStore } from './boardStore.js';
import { createCollaborateComponents } from './collaborateComponents.js';

export function createCollaborateRouter(store: BoardStore): Router {
  const router=Router({mergeParams:true});
  const components=createCollaborateComponents(store);
  router.post('/:node/refresh',async(request,response)=>{
    try {
      response.json(await components.refresh(String((request.params as {id?:string}).id),request.params.node,request.body.identity,request.body.actionId));
    } catch(error) { response.status(400).json({error:String((error as Error).message)}); }
  });
  router.post('/:node/approve',async(request,response)=>{
    try {
      response.json(await components.approve(String((request.params as {id?:string}).id),request.params.node,request.body.digest,request.body.source,request.body.actionId));
    } catch(error) { response.status(400).json({error:String((error as Error).message)}); }
  });
  for(const operation of ['preflight','begin','receipt'] as const)router.post(`/:node/launch-${operation}`,async(request,response)=>{
    try {
      const boardId=String((request.params as {id?:string}).id),nodeId=request.params.node;
      const result=operation==='preflight'?await components.preflight(boardId,nodeId,request.body.request):operation==='begin'?await components.beginLaunch(boardId,nodeId,request.body.request):await components.recordLaunch(boardId,nodeId,request.body.request,request.body.receipt);
      response.json(result);
    } catch(error) { response.status(400).json({error:String((error as Error).message)}); }
  });
  return router;
}

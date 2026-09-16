import {Router} from 'express';
import {randomUUID} from 'node:crypto';
import type {BoardStore} from './boardStore.js';
import {sendBoardError} from './boardRoutes.js';
import {createSessionCollection} from './sessionCollection.js';
import {createCoordinatorActions} from './coordinatorActions.js';
export function createImportRouter(store:BoardStore):Router{
 const router=Router({mergeParams:true}),collection=createSessionCollection(store),coordinator=createCoordinatorActions(store);
 router.post('/refresh',async(request,response)=>{try{
  const id=String((request.params as {id:string}).id);response.json(await store.read(id));void collectBoardSessions(store,id).catch(()=>{});
 }catch(error){sendBoardError(response,error);}});
 router.post('/operation',async(request,response)=>{try{response.json(await collection.prepareDelivery(String((request.params as {id:string}).id),request.body.requestId,request.body.identity));}catch(error){sendBoardError(response,error);}});
 router.post('/delivery',async(request,response)=>{try{response.json(await collection.recordDelivery(String((request.params as {id:string}).id),request.body.requestId,request.body.identity,request.body.receipt));}catch(error){sendBoardError(response,error);}});
 router.post('/publish',async(request,response)=>{try{
  const board=await collection.publish(String((request.params as {id:string}).id),request.body.requestId,request.body.identity,request.body.summary);response.json(board);
  if(board.coordinatorIdentity!==request.body.identity)void queueCollectionSynthesis(store,board.id,coordinator).catch(()=>{});
 }catch(error){sendBoardError(response,error);}});
 return router;
}
async function queueCollectionSynthesis(store:BoardStore,id:string,coordinator=createCoordinatorActions(store)):Promise<void>{
 const board=await store.read(id);if(!board.coordinatorIdentity || board.actions.some(action=>action.kind==='collect-work' && ['queued','claimed','unknown'].includes(action.phase)))return;
 const action=`collect-${randomUUID()}`;await coordinator.queue(id,board.revision,action,'collect-work','Collect selected sessions and synthesize their goals and scope without starting or rebinding work.');await coordinator.deliver(id,action);
}
const collecting=new Set<string>();
export async function collectBoardSessions(store:BoardStore,id:string):Promise<void>{
 if(collecting.has(id))return;collecting.add(id);
 try{await createSessionCollection(store).begin(id);await queueCollectionSynthesis(store,id);}finally{collecting.delete(id);}
}

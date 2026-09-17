import {getQuestionState} from '../../shared/questions.js';
import {isRecord,type BoardSnapshot} from '../../shared/board.js';

export function compactBoardOutput(value:unknown):unknown {
 if(!isRecord(value))return value;
 if(isRecord(value.board))return {...value,board:compactBoardOutput(value.board)};
 if(value.version!==1 || !Array.isArray(value.nodes) || !Array.isArray(value.actions))return value;
 const board=value as unknown as BoardSnapshot;
 return {
  id:board.id,title:board.title,revision:board.revision,deliveryId:board.deliveryId,
  coordinatorIdentity:board.coordinatorIdentity,implementationRunId:board.implementationRunId,
  specApproval:board.specApproval,preview:board.preview,specDigest:value.specDigest,graphDigest:value.graphDigest,
  pauseNewStarts:board.pauseNewStarts,pausedNodeIds:board.pausedNodeIds,
  observationError:board.observationError,discussionStatus:board.discussionStatus,
  nodes:board.nodes.filter(node=>!node.removed).map(node=>({
   id:node.id,title:node.title,kind:node.kind,revision:node.revision,assignment:node.assignment,
   imported:node.imported?{ownerIdentity:node.imported.ownerIdentity,native:node.imported.native,status:node.imported.status,resultPath:node.imported.resultPath,proposedFields:Object.keys(node.imported.proposals)}:undefined,
   collaborate:node.collaborate,
  })),
  actions:board.actions.map(({payload,...action})=>({...action,...(['queued','claimed','unknown'].includes(action.phase)?{payload}:{})})),
  attempts:board.attempts.map(({id,nodeId,nodeRevision,runId,taskId,dispatchId,nativeStatus,stopped,resultPath})=>({id,nodeId,nodeRevision,runId,taskId,dispatchId,nativeStatus,stopped,resultPath})),
  collection:board.collection,pendingQuestions:board.messages.filter(message=>message.nativeMessageId && getQuestionState(board,message)==='pending'),
  detail:'Use read for full content, graph, component state and history',
 };
}

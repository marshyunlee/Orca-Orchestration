import type {BoardSnapshot,BoardMessage} from './board.js';

export function getQuestionState(board:BoardSnapshot,message:BoardMessage):'answered'|'settled'|'pending' {
 if(message.answered)return 'answered';
 let status:string|undefined;
 if(message.importedNodeId){
  const work=board.nodes.find(node=>node.id===message.importedNodeId)?.imported;
  if(work?.native && message.author===`dispatch:${work.native.dispatchId}`)status=work.status;
 }else if(message.componentNodeId){
  status=board.components[message.componentNodeId]?.tasks.find(task=>message.author===`dispatch:${task.dispatchId}`)?.state;
 }else{
  const attempt=board.attempts.find(attempt=>message.author===`dispatch:${attempt.dispatchId}`);
  status=attempt?.stopped?'stopped':attempt?.nativeStatus;
 }
 return status && ['completed','succeeded','failed','stopped','cancelled','canceled','abandoned'].includes(status)?'settled':'pending';
}

import type { BoardSnapshot } from '../../shared/board.js';
import type { DependencyEvidence } from '../../shared/collaborate.js';
import { digestValue } from './boardGraph.js';

export function resolveBoardDependencies(board: BoardSnapshot, nodeId: string): DependencyEvidence[] {
  return board.edges.filter(edge=>edge.target===nodeId).flatMap<DependencyEvidence>(edge=>{
    const predecessor=board.nodes.find(node=>node.id===edge.source && !node.removed);
    if(!predecessor)throw new Error('Dependency node is unavailable');
    if(predecessor.kind==='run')return [];
    if(predecessor.collaborate){
      const result=board.components[predecessor.id]?.result;
      if(!result || result.nodeRevision!==predecessor.revision)throw new Error(`Unresolved predecessor ${predecessor.title}`);
      return [{nodeId:predecessor.id,kind:'component' as const,evidenceId:result.id,digest:result.digest}];
    }
    const attempt=board.attempts.filter(attempt=>attempt.nodeId===predecessor.id && (attempt.nodeRevision===predecessor.revision || attempt.acceptedForRevision===predecessor.revision) && attempt.nativeStatus==='completed').at(-1);
    if(!attempt)throw new Error(`Unresolved predecessor ${predecessor.title}`);
    return [{nodeId:predecessor.id,kind:'direct' as const,evidenceId:attempt.id,digest:digestValue({id:attempt.id,resultPath:attempt.resultPath}),taskId:attempt.taskId,runId:attempt.runId}];
  });
}

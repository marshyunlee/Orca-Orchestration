import type { BoardNode, ActionRecord } from '../../shared/board.js';
export const componentActionKinds=['component-start','component-guidance','component-stop','component-reconcile','component-question'];
export function componentActionPrompt(boardId:string,node:BoardNode,action:ActionRecord,cli:string,url:string):string {
  return [
    `Orca collaborate component request: ${action.kind}. Board ${boardId}; node ${node.id}; action ${action.id}.`,
    `You remain the component master. Preserve your existing native Run and mailbox. This is not a parent worker Dispatch.`,
    `Use ${cli} read --board ${boardId} --url ${url}; claim this exact action using component-claim --node ${node.id} --action ${action.id}.`,
    `Follow the installed collaborate skill inside your registered feature checkout. Use manifest ${node.collaborate!.manifestPath}. Keep its Run identity and full native provenance.`,
    `If the manifest or gate is not ready, author the concrete gate from the approved node scope, initialize your own Run if needed, then component-refresh and component-finish with its evidence. The human approves the displayed gate; an earlier board Start does not approve a new gate.`,
    `After a current gate approval, every implementation, cross-review and repair uses the installed restricted launch.py worker path. Board admission is mandatory there. Do not replace it with generic worker-start, launch with an unregistered helper copy, or rebind this session to the delivery coordinator Run.`,
    `Read queued component actions during supervision. Pause blocks future admissions; already-admitted workers settle normally. Preserve native persist/release/ack ordering and exact report/snapshot evidence.`,
    `For guidance, send the saved revision to the exact active child Dispatch and report acknowledgment separately. For stop, settle each active child using native stop/recovery, archive evidence, and preserve this master. A new node/gate revision needs its corresponding approval before rerun.`,
    `For a component-question action, reply to its exact native message ID with the human's saved answer. Never consume another component's mailbox.`,
    `When a selected candidate is applied and adjudicated, publish component-result with selectionPath, candidateStatePath, gateResultPath and exact nodeRevision. Use component-finish for this processed action. Never mark a component successful merely because one candidate finished.`,
    `Current node revision ${node.revision}: ${JSON.stringify(node.content)}. Action: ${JSON.stringify(action.payload)}`,
  ].join('\n');
}

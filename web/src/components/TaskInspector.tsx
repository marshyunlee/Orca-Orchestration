import { useState } from "react";
import type { BoardNode, BoardSnapshot, NodeContent, Assignment } from "../../../shared/board.js";
import { AttemptHistory } from "./AttemptHistory.js";
const sections: {key:keyof NodeContent;label:string}[]=[{key:"prompt",label:"Prompt"},{key:"plan",label:"Plan"},{key:"design",label:"Design"},{key:"implementationNotes",label:"Implementation"}];
export function TaskInspector({board,node,drafts,onDraft,onSave,onDiscard,error}:{board:BoardSnapshot;node:BoardNode;drafts:Record<string,string>;onDraft:(section:string,value:string)=>void;onSave:(title:string,content:NodeContent,assignment:Assignment|null)=>void;onDiscard:()=>void;error?:string}) {
  const [section,setSection]=useState<keyof NodeContent|"history">("prompt");
  const prefix=`${board.id}/${node.id}/`;
  const value=(field:string,fallback:string)=>drafts[prefix+field]??fallback;
  const content=Object.fromEntries(sections.map(item=>[item.key,value(item.key,node.content[item.key])])) as unknown as NodeContent;
  const assignment=JSON.parse(value("assignment",JSON.stringify(node.assignment))) as Assignment|null;
  const dirty=Object.keys(drafts).some(key=>key.startsWith(prefix));
  return <section className="task-inspector">
    <label>Title<input value={value("title",node.title)} onChange={event=>onDraft("title",event.target.value)}/></label>
    <div className="section-tabs">{sections.map(item=><button key={item.key} aria-pressed={section===item.key} onClick={()=>setSection(item.key)}>{item.label}</button>)}<button aria-pressed={section==="history"} onClick={()=>setSection("history")}>History</button></div>
    {section==="history"?<AttemptHistory attempts={board.attempts.filter(attempt=>attempt.nodeId===node.id)}/>:<label>{sections.find(item=>item.key===section)!.label}<textarea aria-label={sections.find(item=>item.key===section)!.label} value={content[section]} placeholder={section==="implementationNotes"?"Implementation notes. Generated code appears after execution.":"No content yet. Write a draft or ask the coordinator."} onChange={event=>onDraft(section,event.target.value)}/></label>}
    {node.kind==="task" && <label>Assigned agent<select value={assignment?.kind==="member"?assignment.identity:assignment?.kind??""} onChange={event=>onDraft("assignment",JSON.stringify(event.target.value==="new-worker"?{kind:"new-worker",agent:"codex",workspacePath:""}:event.target.value?{kind:"member",identity:event.target.value}:null))}>
      <option value="">Choose an agent</option>{board.members.map(member=><option key={member.identity} value={member.identity}>{member.tabName} · {member.source} · {member.sessionId}</option>)}<option value="new-worker">New worker</option>
    </select></label>}
    {assignment?.kind==="new-worker" && <div className="worker-placement"><label>Agent<select value={assignment.agent} onChange={event=>onDraft("assignment",JSON.stringify({...assignment,agent:event.target.value}))}>{["codex","claude","cursor"].map(agent=><option key={agent}>{agent}</option>)}</select></label><label>Workspace<input value={assignment.workspacePath} onChange={event=>onDraft("assignment",JSON.stringify({...assignment,workspacePath:event.target.value}))} placeholder="Absolute task workspace path"/></label></div>}
    {dirty && <p className="unsaved">Unsaved changes</p>}{error && <p role="alert">{error}</p>}
    <div className="board-actions"><button disabled={!dirty} onClick={()=>onSave(value("title",node.title),content,assignment)}>Save</button><button disabled={!dirty} onClick={onDiscard}>Discard</button></div>
  </section>;
}

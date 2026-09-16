import type {MemberRef} from '../../../shared/board.js';
export interface SessionInventory {members:MemberRef[];unavailable:{tabName:string;terminalHandle:string;reason:string}[]}
export function SessionPicker({inventory,members,coordinatorIdentity,onChange}:{inventory:SessionInventory;members:MemberRef[];coordinatorIdentity:string;onChange:(members:MemberRef[],coordinator:string)=>void}){
 function select(next:MemberRef[]){onChange(next,next.some(member=>member.identity===coordinatorIdentity)?coordinatorIdentity:next[0]?.identity??'');}
 return <div className="member-picker"><p>Select exact sessions. Duplicate tab names are shown with their session IDs. Leave empty to start a new group.</p>
  {inventory.members.map(member=><label className="member-option" key={`${member.identity}/${member.terminalHandle}`}><input type="checkbox" checked={members.some(current=>current.identity===member.identity && current.terminalHandle===member.terminalHandle)} onChange={event=>select(event.target.checked?[...members.filter(current=>current.identity!==member.identity),member]:members.filter(current=>current.identity!==member.identity))}/><span>{member.tabName} · Connected<small>{member.identity}</small><small>{member.workspacePath}</small></span></label>)}
  {members.filter(member=>!inventory.members.some(current=>current.identity===member.identity && current.terminalHandle===member.terminalHandle)).map(member=><p key={member.identity}>{member.tabName} · {member.identity} · Unavailable <button type="button" onClick={()=>select(members.filter(current=>current.identity!==member.identity))}>Remove selection</button></p>)}
  {inventory.unavailable.map(member=><p key={member.terminalHandle}>{member.tabName} · Unavailable: {member.reason}</p>)}
  {members.length>0 && <label>Coordinator<select value={coordinatorIdentity} onChange={event=>onChange(members,event.target.value)}>{members.map(member=><option key={member.identity} value={member.identity}>{member.tabName} · {member.identity}</option>)}</select></label>}
 </div>;
}

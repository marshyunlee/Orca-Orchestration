import type { BoardSnapshot } from "../../../shared/board.js";
export function GroupTabs({boards,selectedId,onSelect,onCreate,onHistory}:{boards:BoardSnapshot[];selectedId:string|null;onSelect:(id:string)=>void;onCreate:()=>void;onHistory:()=>void}) {
  return <nav className="group-tabs" aria-label="Session groups">
    {boards.map(board=><button key={board.id} role="tab" aria-selected={selectedId===board.id} onClick={()=>onSelect(board.id)}>{board.title}</button>)}
    <button onClick={onCreate}>+ New group</button><button className="history-link" onClick={onHistory}>Native run history</button>
  </nav>;
}

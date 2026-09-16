import {useEffect,useRef,useState} from "react";
import type {BoardSnapshot,BoardNode,FileEdit,BoardEdit} from "../../../shared/board.js";
import {boardRequest,fetchBoardArtifact} from "../api.js";
export function ImplementationEditor({board,node,onSnapshot,onEdit}:{board:BoardSnapshot;node:BoardNode;onSnapshot:(board:BoardSnapshot)=>void;onEdit:(operation:BoardEdit)=>void}){
 const [files,setFiles]=useState<string[]>([]),[workspace,setWorkspace]=useState(""),[gitDiff,setGitDiff]=useState("");
 const [path,setPath]=useState(""),[edits,setEdits]=useState<FileEdit[]>([]),[patch,setPatch]=useState("");
 const [draftId,setDraftId]=useState<string|null>(null),[error,setError]=useState(""),[status,setStatus]=useState("");
 const [busy,setBusy]=useState(false);const applyId=useRef<string|null>(null);
 const [incoming,setIncoming]=useState<FileEdit|null>(null);
 const selected=edits.find(edit=>edit.path===path);
 const base=`/api/boards/${board.id}/files`;
 const cacheKey=`orca-file-draft/${board.id}/${node.id}`;
 useEffect(()=>{
  let current=true;
  void (async()=>{
    const result=await boardRequest<{workspace:string;files:string[];diff:string;truncated:boolean}>(`${base}?node=${encodeURIComponent(node.id)}`);
    if(!current)return;
    setFiles(result.files);setWorkspace(result.workspace);setGitDiff(result.diff);
    if(result.truncated)setStatus("Showing the first 2,000 files; enter an exact path to open another.");
    let cached:null|{workspace:string;edits:FileEdit[];path:string}=null;
    try{cached=JSON.parse(localStorage.getItem(cacheKey)??"null");}catch{}
    if(cached?.workspace===result.workspace){setEdits(cached.edits);setPath(cached.path);setStatus("Restored unsaved file draft. Project files are unchanged.");return;}
    const draft=board.actions.filter(action=>action.kind==="file-draft" && action.nodeId===node.id && action.receiptPath).at(-1);
    if(draft){const saved=JSON.parse(await fetchBoardArtifact(board.id,draft.receiptPath!));if(current && saved.workspace===result.workspace){setEdits(saved.edits);setPath(saved.edits[0]?.path??"");setDraftId(draft.id);}}
  })().catch(error=>{if(current)setError(String(error));});
  return ()=>{current=false;};
 },[base,node.id]);
 function change(next:FileEdit[]){localStorage.setItem(cacheKey,JSON.stringify({workspace,edits:next,path:next.some(edit=>edit.path===path)?path:next[0]?.path??""}));setEdits(next);setDraftId(null);applyId.current=null;setStatus("Draft changed; project files are unchanged.");}
 async function openFile(){setBusy(true);try{const file=await boardRequest<FileEdit>(`${base}/read?node=${encodeURIComponent(node.id)}&path=${encodeURIComponent(path)}`);change([...edits.filter(edit=>edit.path!==path),file]);setError("");}catch(error){setError(String(error));}finally{setBusy(false);}}
 async function previewDiff(){setBusy(true);try{const result=await boardRequest<{edits:FileEdit[]}>(`${base}/preview-diff`,{nodeId:node.id,diff:patch});change(result.edits);setPath(result.edits[0]?.path??"");setError("");}catch(error){setError(String(error));}finally{setBusy(false);}}
 async function saveDraft(){setBusy(true);try{const result=await boardRequest<{snapshot:BoardSnapshot;draftId:string}>(`${base}/stage`,{nodeId:node.id,baseRevision:board.revision,actionId:crypto.randomUUID(),edits});setDraftId(result.draftId);onSnapshot(result.snapshot);setStatus("Draft saved. Apply explicitly to write workspace files.");setError("");}catch(error){setError(String(error));}finally{setBusy(false);}}
 async function apply(){setBusy(true);applyId.current??=crypto.randomUUID();try{const result=await boardRequest<{snapshot:BoardSnapshot;action:{phase:string;error:string|null}}>(`${base}/apply`,{draftId,actionId:applyId.current,baseRevision:board.revision});onSnapshot(result.snapshot);if(result.action.phase!=="applied")throw new Error(result.action.error??`Application ${result.action.phase}; inspect its receipt before retrying`);localStorage.removeItem(cacheKey);setStatus("Applied to workspace. Validation has not run.");setError("");setDraftId(null);applyId.current=null;}catch(error){setError(String(error));}finally{setBusy(false);}}
 return <section className="implementation-editor"><h3>Workspace files</h3><p className="workspace-path">{workspace || "Choose a workspace assignment first."}</p><p>Opening or editing files changes only the draft. Apply writes the selected workspace.</p>
  <label>File<select value={path} onChange={event=>setPath(event.target.value)}><option value="">Select a file</option>{[...new Set([...files,...edits.map(edit=>edit.path)])].map(file=><option key={file}>{file}</option>)}</select></label>
  <label>File path<input value={path} onChange={event=>setPath(event.target.value)} placeholder="src/example.ts"/></label><button disabled={busy || !path} onClick={()=>void openFile()}>Open / Reload file</button>
  {selected && <><button disabled={busy} onClick={()=>void boardRequest<FileEdit>(`${base}/read?node=${encodeURIComponent(node.id)}&path=${encodeURIComponent(path)}`).then(setIncoming).catch(error=>setError(String(error)))}>Compare with workspace</button>{incoming?.path===path && <details open><summary>Current workspace content</summary><pre className="preserve-lines">{incoming.content}</pre><button onClick={()=>{change(edits.map(edit=>edit.path===path?{...edit,baseDigest:incoming.baseDigest}:edit));setIncoming(null);setError("");}}>Keep my draft on this file version</button></details>}<label>File content<textarea className="code-editor" value={selected.content??""} disabled={selected.content===null} onChange={event=>change(edits.map(edit=>edit.path===path?{...edit,content:event.target.value}:edit))}/></label><label className="delete-file"><input type="checkbox" checked={selected.content===null} onChange={event=>change(edits.map(edit=>edit.path===path?{...edit,content:event.target.checked?null:""}:edit))}/>Delete this file on Apply</label></>}
  <details><summary>Current workspace diff</summary><pre className="preserve-lines">{gitDiff || "No tracked working-tree diff."}</pre></details>
  <details><summary>Paste a proposed unified diff</summary><textarea aria-label="Proposed unified diff" value={patch} onChange={event=>setPatch(event.target.value)}/><button disabled={busy || !patch.trim()} onClick={()=>void previewDiff()}>Preview diff</button></details>
  {edits.length>0 && <p>{edits.length} staged file(s): {edits.map(edit=>edit.path).join(", ")}</p>}
  <div className="board-actions"><button disabled={busy || !edits.length} onClick={()=>{setEdits([]);setDraftId(null);setIncoming(null);applyId.current=null;localStorage.removeItem(cacheKey);setStatus("File drafts discarded. Project files are unchanged.");}}>Discard file drafts</button><button disabled={busy || !edits.length} onClick={()=>void saveDraft()}>Save file draft</button><button disabled={busy || !draftId} onClick={()=>void apply()}>Apply to workspace</button><button disabled={busy || !edits.length} onClick={()=>onEdit({kind:"guidance",nodeId:node.id,body:`Review and apply this human-edited patch at your next checkpoint. Report conflicts before writing:\n${JSON.stringify(edits)}`})}>Send patch as guidance</button></div>
  {status && <p role="status">{status}</p>}{error && <p role="alert">{error}</p>}
 </section>;
}

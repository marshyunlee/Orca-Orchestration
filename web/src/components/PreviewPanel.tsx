import {useEffect,useState} from "react";
import type { BoardNode,BoardSnapshot } from "../../../shared/board.js";
import {fetchBoardArtifact} from "../api.js";
function PreviewImage({boardId,path,caption}:{boardId:string;path:string;caption:string}){
 const [source,setSource]=useState(""),[error,setError]=useState("");
 useEffect(()=>{let active=true;void fetchBoardArtifact(boardId,path).then(text=>{
  const image=JSON.parse(text);
  if(!["image/png","image/jpeg","image/webp","image/gif"].includes(image.mimeType) || typeof image.base64!=="string")throw new Error("Unsupported preview image");
  if(active)setSource(`data:${image.mimeType};base64,${image.base64}`);
 }).catch(error=>{if(active)setError(String(error));});return()=>{active=false;};},[boardId,path]);
 return <figure>{source && <img src={source} alt={caption} style={{maxWidth:"100%"}}/>}<figcaption>{caption}</figcaption>{error && <p role="alert">{error}</p>}</figure>;
}
export function PreviewPanel({board,node,onUpdate}:{board:BoardSnapshot;node:BoardNode;onUpdate:()=>void}) {
 return <section><h3>Expected deliverable</h3><p>Examples, behavior, and acceptance criteria before execution.</p><div className="preserve-lines">{node.content.design || "The coordinator has not generated a Preview yet."}</div>{board.preview?.images?.map(image=><PreviewImage key={image.artifactPath} boardId={board.id} path={image.artifactPath} caption={image.caption}/>)}<button onClick={onUpdate}>Update preview</button></section>;
}

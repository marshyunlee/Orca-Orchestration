import {createBoardNode, type BoardSnapshot, type NodeContent} from '../../shared/board.js';
import {importedSourceKey, validateImportedItem, type ImportedItem} from '../../shared/imports.js';
import {digestValue} from './boardGraph.js';
const fields:(keyof NodeContent)[]=['prompt','plan','design','implementationNotes'];
export function mergeImportedWork(board:BoardSnapshot,items:ImportedItem[]):void {
 for(const item of items){
  validateImportedItem(item);
  const key=importedSourceKey(item);
  let node=board.nodes.find(node=>node.imported?.key===key);
  if(node?.removed)continue;
  if(!node){
   node=createBoardNode(`import_${digestValue(key).slice(0,32)}`,'task',item.title);
   node.content=structuredClone(item.content);node.position={x:400,y:100+board.nodes.length*140};
   node.imported={...structuredClone(item),key,sourceIdentities:[item.sourceIdentity],baseline:{title:item.title,content:structuredClone(item.content)},proposals:{}};
   board.nodes.push(node);
   board.edges.push({id:`root_${node.id}`,source:board.nodes.find(node=>node.kind==='run')!.id,target:node.id});
  }else{
   const previous=node.imported!;
   const before=JSON.stringify([node.title,node.content]);
   if(node.title===previous.baseline.title){node.title=item.title;delete previous.proposals.title;}
   else if(item.title!==previous.baseline.title)previous.proposals.title=item.title;
   for(const field of fields){
    if(node.content[field]===previous.baseline.content[field]){node.content[field]=item.content[field];delete previous.proposals[field];}
    else if(item.content[field]!==previous.baseline.content[field])previous.proposals[field]=item.content[field];
   }
   if(before!==JSON.stringify([node.title,node.content]))node.revision++;
   node.imported={...previous,...structuredClone(item),sourceIdentities:[...new Set([...previous.sourceIdentities,item.sourceIdentity])],baseline:{title:item.title,content:structuredClone(item.content)}};
  }
  if(item.status==='completed' && item.resultPath && Object.keys(node.imported!.proposals).length===0 && node.title===item.title && fields.every(field=>node!.content[field]===item.content[field]))node.imported!.resultRevision=node.revision;
 }
}

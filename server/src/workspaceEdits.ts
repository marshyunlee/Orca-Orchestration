import {createHash,randomUUID} from "node:crypto";
import {readFile,writeFile,realpath,mkdir,rename,unlink,stat,readdir} from "node:fs/promises";
import {dirname,isAbsolute,join,relative,resolve,sep} from "node:path";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {parsePatch,applyPatch} from "diff";
import type {FileEdit} from "../../shared/board.js";
const execute=promisify(execFile);
export function digestFile(content:string):string{return createHash("sha256").update(content).digest("hex");}
function inside(root:string,path:string):boolean {const part=relative(root,path);return part==="" || (!part.startsWith(`..${sep}`) && part!==".." && !isAbsolute(part));}
export async function resolveWorkspaceFile(workspace:string,path:string):Promise<string>{
 if(typeof path!=="string" || !path || isAbsolute(path) || path.includes("\0") || path.split(/[\\/]/).includes(".."))throw new Error("File path must stay inside the workspace");
 const root=await realpath(workspace),requested=resolve(root,path);
 if(!inside(root,requested))throw new Error("File path escapes workspace");
 let existing=requested;const missing:string[]=[];
 while(true){try{existing=await realpath(existing);break;}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;missing.unshift(existing.slice(dirname(existing).length+1));existing=dirname(existing);}}
 const destination=join(existing,...missing);
 if(!inside(root,destination))throw new Error("Symlink path escapes workspace");
 return destination;
}
export async function readWorkspaceFile(workspace:string,path:string):Promise<FileEdit>{
 const destination=await resolveWorkspaceFile(workspace,path);
 try{
  const info=await stat(destination);if(!info.isFile() || info.size>2*1024*1024)throw new Error("Editor supports text files up to 2 MB");
  const bytes=await readFile(destination),content=bytes.toString("utf8");
  if(bytes.includes(0) || !Buffer.from(content).equals(bytes))throw new Error("Binary files cannot be edited as text");
  return {path,baseDigest:digestFile(content),content};
 }catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return {path,baseDigest:null,content:""};throw error;}
}
export async function listWorkspaceFiles(workspace:string):Promise<{files:string[];diff:string;truncated:boolean}>{
 const root=await realpath(workspace);
 try{
  const files=(await execute("git",["-C",root,"ls-files","--cached","--others","--exclude-standard","-z"],{maxBuffer:4*1024*1024})).stdout.split("\0").filter(Boolean);
  const diff=(await execute("git",["-C",root,"diff","--no-ext-diff","--no-textconv","--","."],{maxBuffer:4*1024*1024})).stdout;
  return {files:files.slice(0,2000),diff,truncated:files.length>2000};
 }catch{
  const files:string[]=[];
  async function visit(directory:string):Promise<void>{
   for(const entry of await readdir(directory,{withFileTypes:true})){
    if(files.length>=2000)return;
    if([".git","node_modules"].includes(entry.name) || entry.isSymbolicLink())continue;
    const path=join(directory,entry.name);if(entry.isDirectory())await visit(path);else if(entry.isFile())files.push(relative(root,path));
   }
  }
  await visit(root);return {files,diff:"",truncated:files.length>=2000};
 }
}
export async function previewWorkspaceDiff(workspace:string,diff:string):Promise<FileEdit[]>{
 if(typeof diff!=="string" || !diff.trim())throw new Error("A unified diff is required");
 const patches=parsePatch(diff);if(!patches.length)throw new Error("No text changes found in diff");
 const edits:FileEdit[]=[];
 for(const patch of patches){
  const oldPath=patch.oldFileName?.replace(/^a\//,""),newPath=patch.newFileName?.replace(/^b\//,"");
  if(!oldPath || !newPath || (oldPath!=="/dev/null" && newPath!=="/dev/null" && oldPath!==newPath))throw new Error("Represent a rename as an explicit deletion and addition");
  const path=newPath==="/dev/null"?oldPath:newPath;
  const original=await readWorkspaceFile(workspace,path);
  if(oldPath==="/dev/null" && original.baseDigest!==null)throw new Error(`File conflict: ${path} already exists`);
  const patched=applyPatch(original.content??"",patch,{fuzzFactor:0,autoConvertLineEndings:false});
  if(patched===false)throw new Error(`Diff context conflict: ${path}`);
  if(newPath==="/dev/null" && patched!=="")throw new Error("Deletion diff does not remove the full file");
  edits.push({...original,content:newPath==="/dev/null"?null:patched});
 }
 return edits;
}
export async function applyWorkspaceEdits(workspace:string,edits:FileEdit[],journalPath:string):Promise<{state:"applied";paths:string[];validation:string}>{
 if(!Array.isArray(edits) || !edits.length)throw new Error("No staged edits");
 const paths=new Set<string>(),preimages:{edit:FileEdit;before:FileEdit;mode:number;destination:string}[]=[];
 for(const edit of edits){
  if(!edit || typeof edit.path!=="string" || (edit.content!==null && typeof edit.content!=="string") || (edit.baseDigest!==null && typeof edit.baseDigest!=="string"))throw new Error("Invalid file edit");
  const destination=await resolveWorkspaceFile(workspace,edit.path);if(paths.has(destination))throw new Error("Duplicate file edit");paths.add(destination);
  const before=await readWorkspaceFile(workspace,edit.path);if(before.baseDigest!==edit.baseDigest)throw new Error(`File conflict: ${edit.path} changed since opening`);
  const mode=before.baseDigest===null?0o644:(await stat(destination)).mode&0o777;
  preimages.push({edit,before,mode,destination});
 }
 await mkdir(dirname(journalPath),{recursive:true,mode:0o700});
 const journal:{state:string;preimages:typeof preimages;applied:string[];restored:string[];conflicts:string[];error?:string}={state:"applying",preimages,applied:[],restored:[],conflicts:[]};
 await writeFile(journalPath,JSON.stringify(journal),{flag:"wx",mode:0o600});
 try{
  for(const item of preimages){
   const fresh=await readWorkspaceFile(workspace,item.edit.path);if(fresh.baseDigest!==item.edit.baseDigest)throw new Error(`File conflict: ${item.edit.path} changed during application`);
   const destination=await resolveWorkspaceFile(workspace,item.edit.path);if(destination!==item.destination)throw new Error("Workspace path changed during application");
   if(item.edit.content===null){if(item.before.baseDigest!==null)await unlink(destination);}
   else{
    await mkdir(dirname(destination),{recursive:true});
    const temporary=join(dirname(destination),`.board-edit-${randomUUID()}`);
    await writeFile(temporary,item.edit.content,{flag:"wx",mode:item.mode});
    try{
     if((await readWorkspaceFile(workspace,item.edit.path)).baseDigest!==item.edit.baseDigest || await resolveWorkspaceFile(workspace,item.edit.path)!==destination)throw new Error(`File conflict: ${item.edit.path} changed before replacement`);
     await rename(temporary,destination);
    }finally{await unlink(temporary).catch(()=>{});}
   }
   journal.applied.push(item.edit.path);await writeFile(journalPath,JSON.stringify(journal),{mode:0o600});
  }
  journal.state="applied";await writeFile(journalPath,JSON.stringify(journal),{mode:0o600});
  return {state:"applied",paths:journal.applied,validation:"Not run"};
 }catch(error){
  journal.error=String(error);
  for(const item of [...preimages].reverse().filter(item=>journal.applied.includes(item.edit.path))){
   try{
    const now=await readWorkspaceFile(workspace,item.edit.path);
    if(now.baseDigest!==(item.edit.content===null?null:digestFile(item.edit.content))){journal.conflicts.push(item.edit.path);continue;}
    const destination=await resolveWorkspaceFile(workspace,item.edit.path);
    if(item.before.baseDigest===null)await unlink(destination);
    else await writeFile(destination,item.before.content!,{mode:item.mode});
    journal.restored.push(item.edit.path);
   }catch{journal.conflicts.push(item.edit.path);}
  }
  journal.state=journal.conflicts.length?"partial":"restored";await writeFile(journalPath,JSON.stringify(journal),{mode:0o600});
  throw new Error(`${String(error)}; application ${journal.state}; see journal ${journalPath}`);
 }
}

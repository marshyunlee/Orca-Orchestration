import { readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isRecord } from '../../shared/board.js';
const execute=promisify(execFile);
export async function readComponentText(path:string,manifestPath:string,manifest:Record<string,unknown>):Promise<{path:string;text:string}>{
  const actual=await realpath(isAbsolute(path)?path:join(dirname(manifestPath),path));
  const roots=[await realpath(dirname(manifestPath))];
  if(typeof manifest.bulk_dir==='string'){
    const bulk=await realpath(manifest.bulk_dir),allowed=await realpath(process.env.ORCA_COLLABORATE_BULK_ROOT??join(homedir(),'.local/state/collaborate'));
    const child=relative(allowed,bulk);
    if(child.startsWith('..') || isAbsolute(child))throw new Error('Candidate evidence is outside the collaborate bulk root');
    roots.push(bulk);
  }
  if(!roots.some(root=>{const child=relative(root,actual);return child && !child.startsWith('..') && !isAbsolute(child);}))throw new Error('Evidence is outside this component manifest and candidate directories');
  const text=await readFile(actual,'utf8');
  if(Buffer.byteLength(text)>4*1024*1024)throw new Error('Evidence file is too large');
  return {path:actual,text};
}
export async function readComponentEvidence(path:string,manifestPath:string,manifest:Record<string,unknown>):Promise<{path:string;value:Record<string,unknown>}>{
  const {path:actual,text}=await readComponentText(path,manifestPath,manifest);
  const value:unknown=JSON.parse(text);if(!isRecord(value))throw new Error('Structured component evidence required');
  return {path:actual,value};
}
export async function verifySelectionRecord(path:string):Promise<void>{
  const helper=process.env.ORCA_COLLABORATE_LEDGER_HELPER;
  if(!helper)throw new Error('Configure the collaborate ledger validator');
  await execute(process.env.ORCA_BOARD_PYTHON??'python3',[helper,'validate','--record',path],{timeout:30000,maxBuffer:1024*1024});
}

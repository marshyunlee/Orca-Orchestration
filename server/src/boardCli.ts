#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { executeNativeOperation, type CoordinatorCaller, type NativeOperation } from "./orca.js";

const args = process.argv.slice(2);
const option = (name: string): string => {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1]) throw new Error(`Missing ${name}`);
  return args[index + 1];
};

async function main(): Promise<void> {
  if (!args.length || args.includes("--help")) {
    console.log("boardctl native --caller-file <json> --operation-file <json>\nExecute one typed native operation inside the selected coordinator terminal.\nReceipts are JSON; an unknown result must be reconciled before retrying.");
    return;
  }
  if (args[0] !== "native") throw new Error("Unknown boardctl command");
  const caller = JSON.parse(await readFile(option("--caller-file"), "utf8")) as CoordinatorCaller;
  const operation = JSON.parse(await readFile(option("--operation-file"), "utf8")) as NativeOperation;
  const receipt = await executeNativeOperation(operation, caller);
  console.log(JSON.stringify(receipt));
  if (receipt.phase !== "applied") process.exitCode = 1;
}

main().catch(error => { console.error(JSON.stringify({ error: String(error.message ?? error) })); process.exitCode = 1; });

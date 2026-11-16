// Node only: reads a cases file. The browser-safe functions (defineSuite, createPlan,
// importResults, compare and report) never import this module.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Case } from "../contracts/index.ts";
import * as z from "zod";

/** Thrown when a cases file cannot be read. The message names the file and the line. */
export class CasesError extends Error {
  /** The error's name, for `instanceof`-free checks. */
  override readonly name = "CasesError";
}

/**
 * Reads the cases of a suite from a `.jsonl` file (one case per line; blank lines are skipped) or
 * a `.json` file (an array of cases), and checks each one against the case schema. It is
 * synchronous, so a suite module can call it inside `defineSuite`. Every error names the file
 * and the line (or the array index): a line that is not JSON, a case that is not valid, a
 * repeated case ID, or a file that holds no case.
 */
export function loadCases(file: URL | string): Case[] {
  const path = file instanceof URL ? fileURLToPath(file) : file;
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    throw new CasesError(`${path}: ${(error as Error).message}`);
  }
  const entries: Array<{ readonly where: string; readonly value: unknown }> = [];
  if (path.endsWith(".jsonl")) {
    for (const [i, line] of text.split("\n").entries()) {
      if (line.trim() === "") continue;
      entries.push({ where: `${path}:${i + 1}`, value: parse(line, `${path}:${i + 1}`) });
    }
  } else if (path.endsWith(".json")) {
    const value = parse(text, path);
    if (!Array.isArray(value)) throw new CasesError(`${path}: a .json cases file holds an array`);
    for (const [i, item] of value.entries()) entries.push({ where: `${path}[${i}]`, value: item });
  } else {
    throw new CasesError(`${path}: a cases file is .jsonl or .json`);
  }
  if (entries.length === 0) throw new CasesError(`${path}: the file holds no case`);
  const seen = new Map<string, string>();
  return entries.map(({ where, value }) => {
    const parsed = Case.safeParse(value);
    if (!parsed.success)
      throw new CasesError(`${where}: invalid case:\n${z.prettifyError(parsed.error)}`);
    const first = seen.get(parsed.data.id);
    if (first !== undefined)
      throw new CasesError(
        `${where}: case '${parsed.data.id}' repeats the ID of ${first.startsWith(`${path}:`) ? `line ${first.slice(path.length + 1)}` : first}`,
      );
    seen.set(parsed.data.id, where);
    return parsed.data;
  });
}

function parse(text: string, where: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new CasesError(`${where}: not JSON (${(error as Error).message})`);
  }
}

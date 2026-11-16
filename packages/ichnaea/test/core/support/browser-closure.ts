// The static import closure of a set of modules, and what in it would not run in a browser. It
// starts from the walk of scripts/stats/provenance.ts (localImportClosure) and adds the checks:
// a `node:` specifier, a bare Node built-in, a package other than zod, a dynamic import of a
// specifier that is not a literal, and the Node-only globals.
import { readFileSync, realpathSync } from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";

/** Where a static import, re-export or side-effect import names its module: `from "` and `import "`. */
const STATIC = /(?:\bfrom\s*|\bimport\s+)(?=["'])/g;
/** A dynamic import, up to its argument. */
const DYNAMIC = /\bimport\s*\(\s*/g;
/** The Node-only globals, also as a member of globalThis. */
const GLOBALS = /(?<![\w$])(process|Buffer|__dirname|__filename|require)(?![\w$])/g;
const BUILTINS = new Set(builtinModules.map((m) => m.split("/")[0]));
const PACKAGES = new Set(["zod"]);

/**
 * The source with comments and the text of string and template literals replaced by spaces, so
 * that a word in a doc comment or an error message is not read as code. Offsets stay the same,
 * and template expressions stay code.
 */
export function codeOnly(source: string): string {
  const out = [...source];
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " ";
  };
  let i = 0;
  const braces: number[] = [];
  let depth = 0;
  while (i < source.length) {
    const c = source[i] as string;
    const next = source[i + 1];
    if (c === "/" && next === "/") {
      const start = i;
      while (i < source.length && source[i] !== "\n") i++;
      blank(start, i);
    } else if (c === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end < 0 ? source.length : end + 2;
      blank(i, stop);
      i = stop;
    } else if (c === '"' || c === "'") {
      const start = ++i;
      while (i < source.length && source[i] !== c && source[i] !== "\n")
        i += source[i] === "\\" ? 2 : 1;
      blank(start, i);
      i++;
    } else if (c === "`" || (c === "}" && braces.at(-1) === depth - 1)) {
      // A template literal, or the rest of one after a `${…}` expression.
      if (c === "}") {
        braces.pop();
        depth--;
      }
      const start = ++i;
      while (i < source.length && source[i] !== "`") {
        if (source[i] === "\\") i += 2;
        else if (source[i] === "$" && source[i + 1] === "{") break;
        else i++;
      }
      blank(start, i);
      if (source[i] === "$") {
        braces.push(depth);
        depth++;
        i += 2;
      } else i++;
    } else {
      if (c === "{") depth++;
      if (c === "}") depth--;
      i++;
    }
  }
  return out.join("");
}

/** The string literal that starts at `at` in the source, or undefined when none does. */
function literalAt(source: string, at: number): string | undefined {
  const quote = source[at];
  if (quote !== '"' && quote !== "'") return undefined;
  const end = source.indexOf(quote, at + 1);
  return end < 0 ? undefined : source.slice(at + 1, end);
}

/** What one module of the closure does that a browser cannot. */
export interface BrowserProblem {
  readonly file: string;
  readonly problem: string;
}

/**
 * Walks the static import closure of `entries` and returns every problem, with the module that
 * has it. Type-only imports are walked too, which is stricter than the bundle needs.
 */
export function browserProblems(entries: readonly string[]): {
  readonly files: readonly string[];
  readonly problems: readonly BrowserProblem[];
} {
  const seen = new Set<string>();
  const problems: BrowserProblem[] = [];
  const visit = (file: string): void => {
    const real = realpathSync(file);
    if (seen.has(real)) return;
    seen.add(real);
    if (!real.endsWith(".ts")) return;
    const source = readFileSync(real, "utf8");
    const code = codeOnly(source);
    const specifiers: string[] = [];
    for (const m of code.matchAll(STATIC)) {
      const spec = literalAt(source, m.index + m[0].length);
      if (spec !== undefined) specifiers.push(spec);
    }
    for (const m of code.matchAll(DYNAMIC)) {
      const at = m.index + m[0].length;
      const spec = literalAt(source, at);
      const close = source.indexOf(")", at);
      // Only a lone string literal names a module a bundler can see.
      if (spec === undefined || source.slice(at + spec.length + 2, close).trim() !== "")
        problems.push({
          file: real,
          problem: `a dynamic import of ${source.slice(at, close).trim() || "nothing"}`,
        });
      else specifiers.push(spec);
    }
    for (const [, global] of code.matchAll(GLOBALS))
      problems.push({ file: real, problem: `the Node-only global '${global}'` });
    for (const spec of specifiers) {
      if (spec.startsWith(".")) visit(path.resolve(path.dirname(real), spec));
      else if (spec.startsWith("node:"))
        problems.push({ file: real, problem: `the Node built-in '${spec}'` });
      else if (BUILTINS.has(spec.split("/")[0] as string))
        problems.push({ file: real, problem: `the Node built-in '${spec}'` });
      else if (!PACKAGES.has(spec))
        problems.push({ file: real, problem: `the package '${spec}', which is not zod` });
    }
  };
  for (const entry of entries) visit(entry);
  return { files: [...seen].toSorted(), problems };
}

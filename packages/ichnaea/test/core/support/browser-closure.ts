// The static import closure of a set of modules, and what in it would not run in a browser or is
// not pure. It walks the relative imports of the source text and adds
// the checks: a `node:` specifier, a bare Node built-in, a package other than zod, a dynamic import
// of a specifier that is not a literal, the Node-only globals, import.meta.dirname, filename and
// resolve, and a read of the clock or a random draw.
//
// The checks read the source with its comments, strings and regular expressions blanked. A lexer
// cannot tell a regular expression from a division in every context without parsing, so a `/`
// starts one only where the previous token cannot end an operand, and a literal never spans a
// line. A misread that hides code would also unbalance the brackets, so a module whose blanked
// code does not balance them is refused rather than passed.
import { readFileSync, realpathSync } from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";

/** Where a static import, re-export or side-effect import names its module: `from "` and `import "`. */
const STATIC = /(?:\bfrom\s*|\bimport\s+)(?=["'])/g;
/** A dynamic import, up to its argument. */
const DYNAMIC = /\bimport\s*\(\s*/g;
/** The Node-only globals, also as a member of globalThis. */
const GLOBALS =
  /(?<![\w$])(process|Buffer|__dirname|__filename|require|global|setImmediate)(?![\w$])/g;
/** The members of import.meta that exist in Node only. */
const IMPORT_META = /\bimport\s*\.\s*meta\s*\.\s*(dirname|filename|resolve)\b/g;
/** A read of the clock or a random draw; `new Date(value)` with an argument reads no clock. */
const IMPURE: readonly (readonly [RegExp, string])[] = [
  [/\bDate\s*\.\s*now\s*\(/g, "a read of the clock: Date.now("],
  [/\bnew\s+Date\s*\(\s*\)/g, "a read of the clock: new Date()"],
  [/\bnew\s+Date\b(?!\s*\()/g, "a read of the clock: new Date"],
  [/(?<!\bnew\s+)\bDate\s*\(/g, "a read of the clock: Date("],
  // The checks read code with string contents blanked, so `Date["now"]` cannot be told from
  // `Date["parse"]`: every computed member of Date is refused.
  [/\bDate\s*\[/g, "a computed member of Date: Date["],
  [/\bIntl\s*\.\s*DateTimeFormat\b/g, "a read of the clock: Intl.DateTimeFormat"],
  [/\bperformance\s*\.\s*now\s*\(/g, "a read of the clock: performance.now("],
  [/\bMath\s*\.\s*random\s*\(/g, "a random draw: Math.random("],
  [/\bgetRandomValues\s*\(/g, "a random draw: getRandomValues("],
  [/\brandomUUID\s*\(/g, "a random draw: randomUUID("],
];
/**
 * Reserved words after which a `/` starts a regular expression, not a division. `of` is not one:
 * it is a keyword only in a `for` head, and a name anywhere else (see `regexMayStart`).
 */
const BEFORE_REGEX = new Set([
  "return",
  "typeof",
  "instanceof",
  "in",
  "new",
  "delete",
  "void",
  "throw",
  "case",
  "do",
  "else",
  "yield",
  "await",
]);
/** The characters that end a line in JavaScript, and so a line comment. */
const LINE_END = new Set(["\n", "\r", "\u2028", "\u2029"]);
const BUILTINS = new Set(builtinModules.map((m) => m.split("/")[0]));
const PACKAGES = new Set(["zod"]);

/**
 * Whether a `/` at `at` starts a regular expression: the previous token in the blanked code so
 * far is not an operand's end (a name, a number, a closing parenthesis or bracket, a string, a
 * postfix `++` or `--`, or a TypeScript non-null `!` right after an operand), or it is a keyword
 * after which an expression starts. A `++` or `--` just before a `/` is postfix: a prefix one is
 * followed by its operand. A word is read in its token context: after a `.` it is a property name,
 * and `of` is the `for` keyword only after a binding (a name that is not a keyword, or the `]` or
 * `}` of a pattern).
 */
function regexMayStart(out: readonly string[], at: number): boolean {
  let k = at - 1;
  while (k >= 0 && /\s/.test(out[k] as string)) k--;
  if (k < 0) return true;
  const c = out[k] as string;
  if (/[\w$]/.test(c)) {
    let start = k;
    while (start > 0 && /[\w$]/.test(out[start - 1] as string)) start--;
    const word = out.slice(start, k + 1).join("");
    if (!BEFORE_REGEX.has(word) && word !== "of") return false;
    let p = start - 1;
    while (p >= 0 && /\s/.test(out[p] as string)) p--;
    if (out[p] === "." && out[p - 1] !== ".") return false;
    if (word !== "of") return true;
    if (p >= 0 && /[\]}]/.test(out[p] as string)) return true;
    let q = p;
    while (q > 0 && /[\w$]/.test(out[q - 1] as string)) q--;
    return (
      p >= 0 && /[\w$]/.test(out[p] as string) && !BEFORE_REGEX.has(out.slice(q, p + 1).join(""))
    );
  }
  const before = k > 0 ? (out[k - 1] as string) : "";
  if ((c === "+" || c === "-") && before === c) return false;
  if (c === "!" && /[\w$)\]]/.test(before)) return false;
  return !")]\"'`".includes(c);
}

/**
 * The end of the regular expression literal whose opening `/` is at `at`: the index of its closing
 * `/`, or -1 when the line ends first, so it is not one.
 */
function regexEnd(source: string, at: number): number {
  let inClass = false;
  for (let i = at + 1; i < source.length; i++) {
    const c = source[i];
    if (LINE_END.has(c as string)) return -1;
    if (c === "\\") i++;
    else if (c === "[") inClass = true;
    else if (c === "]") inClass = false;
    else if (c === "/" && !inClass) return i;
  }
  return -1;
}

/**
 * The source with comments and the text of string, template and regular expression literals
 * replaced by spaces, so that a word in a doc comment or an error message is not read as code.
 * Offsets stay the same, and template expressions stay code.
 */
export function codeOnly(source: string): string {
  // One element per UTF-16 code unit, as `source[i]` and match offsets count.
  const out = source.split("");
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
      while (i < source.length && !LINE_END.has(source[i] as string)) i++;
      blank(start, i);
    } else if (c === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end < 0 ? source.length : end + 2;
      blank(i, stop);
      i = stop;
    } else if (c === "/" && regexMayStart(out, i) && regexEnd(source, i) > 0) {
      const end = regexEnd(source, i);
      blank(i + 1, end);
      i = end + 1;
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

/** Whether the brackets of blanked code balance and nest. */
function balanced(code: string): boolean {
  const open: string[] = [];
  const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  for (const c of code) {
    if (c === "(" || c === "[" || c === "{") open.push(c);
    else if (c in pairs && open.pop() !== pairs[c]) return false;
  }
  return open.length === 0;
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
    if (!balanced(code))
      problems.push({
        file: real,
        problem:
          "brackets that do not balance once comments, strings and regular expressions are blanked",
      });
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
    for (const [, member] of code.matchAll(IMPORT_META))
      problems.push({ file: real, problem: `the Node-only import.meta.${member}` });
    for (const [pattern, problem] of IMPURE)
      for (const _ of code.matchAll(pattern)) problems.push({ file: real, problem });
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

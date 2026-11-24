import { dirname, resolve } from "node:path";

import ts from "typescript-compiler";

export const typescriptFile = /\.(?:[cm]?[jt]s|[jt]sx)$/;

/** Visits syntax rather than matching text in comments or string contents. */
export function inspectSource(path: string, text: string, inspect: (node: ts.Node) => void): void {
  inspectTree(ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true), inspect);
}

export function inspectTree(source: ts.SourceFile, inspect: (node: ts.Node) => void): void {
  function visit(node: ts.Node): void {
    inspect(node);
    ts.forEachChild(node, visit);
  }
  visit(source);
}

/** A literal module reference and its resolution mode. */
export function moduleReference(node: ts.Node) {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
    const literal = node.moduleSpecifier;
    if (literal && ts.isStringLiteralLike(literal))
      return { literal, mode: ts.ModuleKind.ESNext } as const;
  }
  if (ts.isExternalModuleReference(node) && ts.isStringLiteralLike(node.expression))
    return { literal: node.expression, mode: ts.ModuleKind.CommonJS } as const;
  if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
    const literal = node.argument.literal;
    if (ts.isStringLiteralLike(literal)) return { literal, mode: ts.ModuleKind.ESNext } as const;
  }
  if (ts.isCallExpression(node)) {
    const [literal] = node.arguments;
    if (!literal || !ts.isStringLiteralLike(literal)) return undefined;
    if (node.expression.kind === ts.SyntaxKind.ImportKeyword)
      return { literal, mode: ts.ModuleKind.ESNext } as const;
    if (ts.isIdentifier(node.expression) && node.expression.text === "require")
      return { literal, mode: ts.ModuleKind.CommonJS } as const;
  }
  return undefined;
}

function projectOptions() {
  const defaults: ts.CompilerOptions = {
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    module: ts.ModuleKind.NodeNext,
    strict: true,
    types: [],
  };
  const projects = new Map<string, ts.CompilerOptions>();
  const directories = new Map<string, ts.CompilerOptions>();
  return (file: string): ts.CompilerOptions => {
    const directory = dirname(resolve(file));
    let options = directories.get(directory);
    if (!options) {
      const config = ts.findConfigFile(directory, ts.sys.fileExists);
      options = (config && projects.get(config)) || defaults;
      if (config && !projects.has(config)) {
        const read = ts.readConfigFile(config, ts.sys.readFile);
        if (read.error)
          throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, "\n"));
        const parsed = ts.parseJsonConfigFileContent(
          read.config,
          ts.sys,
          dirname(config),
          undefined,
          config,
        );
        options = { ...options, ...parsed.options };
        projects.set(config, options);
      }
      directories.set(directory, options);
    }
    return options;
  };
}

/** Resolve using the nearest project's compiler options, including paths and package exports. */
export function moduleResolver() {
  const options = projectOptions();
  return (file: string, reference: NonNullable<ReturnType<typeof moduleReference>>) => {
    return ts.resolveModuleName(
      reference.literal.text,
      resolve(file),
      options(file),
      ts.sys,
      undefined,
      undefined,
      reference.mode,
    ).resolvedModule;
  };
}

export function lineOf(node: ts.Node): number {
  const file = node.getSourceFile();
  return file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
}

/** One real TypeScript program per project, with the same options and import resolution as tsc. */
export function projectSources(files: readonly string[]) {
  const options = projectOptions();
  const groups = Map.groupBy(files, options);
  const programs = new Map<ts.CompilerOptions, ts.Program>();
  return (file: string) => {
    const config = options(file);
    let program = programs.get(config);
    if (!program) {
      const roots = groups.get(config) ?? [];
      program = ts.createProgram(
        roots.map((root) => resolve(root)),
        {
          ...config,
          allowJs: true,
          noEmit: true,
          skipLibCheck: true,
        },
      );
      programs.set(config, program);
    }
    const source = program.getSourceFile(resolve(file));
    if (!source) throw new Error(`TypeScript could not load ${file}`);
    return { source, checker: program.getTypeChecker() };
  };
}

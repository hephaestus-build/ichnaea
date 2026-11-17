// Fails the build when code that runs in the browser imports a Node built-in. A Vite build only
// warns, and leaves the module out, so without this a Node-only import in the library would reach
// the playground and break there at runtime. The library has no bundler of its own, so this build
// is its browser check (docs.yml runs it on every change to the library's sources).
import { builtinModules } from "node:module";

const NODE_BUILTINS = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);

interface ResolveContext {
  error(message: string): never;
  readonly environment?: { readonly config: { readonly consumer: string } };
}

export function browserOnly() {
  return {
    name: "ichnaea-browser-only",
    enforce: "pre" as const,
    resolveId(
      this: ResolveContext,
      id: string,
      importer: string | undefined,
      options?: { ssr?: boolean },
    ) {
      // The pages render in Node at build time; only the client and its workers run in a browser.
      if (options?.ssr || this.environment?.config.consumer === "server") return null;
      if (id.startsWith("node:") || NODE_BUILTINS.has(id))
        this.error(
          `${importer ?? "a browser module"} imports the Node built-in '${id}', which a browser cannot load`,
        );
      return null;
    },
  };
}

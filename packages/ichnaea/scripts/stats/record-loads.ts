// Records what this process loads as modules, for the provenance of a study (provenance.ts). A
// study that writes a sidecar runs with this file preloaded:
//   node --import ./scripts/stats/record-loads.ts scripts/stats/<study>.ts …
// The hooks are then in place before the study's own imports load, so the record holds the study
// script, every module it imports, a dynamic import whatever its specifier, and the files of the
// third-party packages under node_modules, each with the modules that resolved it. A type-only
// import never loads, so it is not recorded. The record also notes a load of node:worker_threads:
// a worker thread has its own loader, so what it loads is not recorded here.
//
// Nothing loaded before the hooks is recorded: this file itself, which is therefore not pinned,
// and a module preloaded by an earlier --import, for example through NODE_OPTIONS. This file
// imports nothing local for the same reason. provenance.ts reads the record through the global
// symbol below.
import { registerHooks } from "node:module";

/** The URLs loaded, and for each loaded file the URLs of the modules that resolved it. */
const record = { loaded: new Set<string>(), resolvedBy: new Map<string, Set<string>>() };
registerHooks({
  resolve(specifier, context, nextResolve) {
    const result = nextResolve(specifier, context);
    const { parentURL } = context;
    if (parentURL !== undefined && result.url.startsWith("file:")) {
      const parents = record.resolvedBy.get(result.url) ?? new Set<string>();
      record.resolvedBy.set(result.url, parents.add(parentURL));
    }
    return result;
  },
  load(url, context, nextLoad) {
    if (url.startsWith("file:") || url === "node:worker_threads") record.loaded.add(url);
    return nextLoad(url, context);
  },
});
// The same key as LOADED_MODULES in provenance.ts.
Object.defineProperty(globalThis, Symbol.for("ichnaea.stats.loaded-modules"), { value: record });

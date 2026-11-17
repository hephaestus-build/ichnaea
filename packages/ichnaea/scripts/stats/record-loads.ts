// Records every file that this process loads as a module, for the provenance of a study
// (provenance.ts). A study that writes a sidecar runs with this file preloaded:
//   node --import ./scripts/stats/record-loads.ts scripts/stats/<study>.ts …
// The hook is then in place before the study's own imports load, so the record holds the study
// script, every module it imports, a dynamic import whatever its specifier, and the third-party
// packages under node_modules. A type-only import never loads, so it is not recorded.
//
// This file imports nothing local, because a module loaded before the hook would be missing from
// the record. provenance.ts reads the record through the global symbol below.
import { registerHooks } from "node:module";

const loaded = new Set<string>();
registerHooks({
  load(url, context, nextLoad) {
    if (url.startsWith("file:")) loaded.add(url);
    return nextLoad(url, context);
  },
});
// The same key as LOADED_MODULES in provenance.ts.
Object.defineProperty(globalThis, Symbol.for("ichnaea.stats.loaded-modules"), { value: loaded });

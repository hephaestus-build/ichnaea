// Records what this process loads as modules, for the provenance of a study (provenance.ts). A
// study that writes a sidecar runs with this file preloaded:
//   node --import ./scripts/stats/record-loads.ts scripts/stats/<study>.ts …
// The hooks are then in place before the study's own imports load. The recorder is the package's
// own (src/core/load-record.ts), which a measure's implementation digest uses too; its comment says
// what it records. Nothing loaded before the hooks is recorded: this file and the recorder, which
// are therefore not pinned, and a module preloaded by an earlier --import, for example through
// NODE_OPTIONS. provenance.ts reads the record through the recorder's global key.
import { recordLoads } from "../../src/core/load-record.ts";

recordLoads();

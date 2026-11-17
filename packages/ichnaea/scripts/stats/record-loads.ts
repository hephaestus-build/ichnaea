// Records what this process loads as modules, for the provenance of a study (provenance.ts). A
// study that writes a sidecar runs with this file preloaded:
//   node --import ./scripts/stats/record-loads.ts scripts/stats/<study>.ts …
// The hooks are then in place before the study's own imports load. The recorder is the package's
// own (src/core/load-record.ts), which a measure's implementation digest uses too; its comment says
// what it records. Nothing loaded before the hooks is recorded: this file and the recorder, and a
// module preloaded by an earlier --import, for example through NODE_OPTIONS. provenance.ts imports
// the recorder too (loadRecord, pinLoads), but this preload has loaded it already, so the hooks
// never see it load: a study's sidecar pins neither this file nor src/core/load-record.ts
// (test/stats-studies/provenance.test.ts asserts it). Neither can change an output: they only record loads.
import { recordLoads } from "../../src/core/load-record.ts";

recordLoads();

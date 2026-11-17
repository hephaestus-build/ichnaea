// The child process of `moduleImplementation` (implementation.ts): it records the loads, imports
// one module, and sends its parent what the module loaded, pinned from a root. Its arguments are
// the module's path and the root. A fresh process holds no module that an earlier import loaded,
// so the record holds everything the module loads. The result goes over the IPC channel, so a
// module that writes to standard output cannot change it.
import { pathToFileURL } from "node:url";

import { loadRecord, pinLoads, recordLoads } from "./load-record.ts";

const [module, root] = process.argv.slice(2);
if (module === undefined || root === undefined || process.send === undefined)
  throw new Error("usage: a child process with IPC, given the module's path and the root");
recordLoads();
await import(pathToFileURL(module).href);
const record = loadRecord();
if (record === undefined) throw new Error("the loads were not recorded");
// The same tag as LOADS in implementation.ts.
process.send({ "ichnaea.loads": pinLoads(record, root) });

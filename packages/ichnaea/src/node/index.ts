// The Node-only part of the library: functions that read files. The package's main export stays
// free of them, so the library functions run in a browser.
export * from "./cases.ts";
// The record type that loadCases returns, type-only, so this subpath's signature names nothing
// it does not export.
export type { Case } from "../contracts/index.ts";

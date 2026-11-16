// A JSON import, not a file read, so the version is known in a browser too. The package.json sits
// two directories above this module, in `src/core/` and in `dist/core/`.
import manifest from "../../package.json" with { type: "json" };

/** The version of the Ichnaea package, checked against plugins' peer ranges. */
export const CORE_VERSION: string = manifest.version;

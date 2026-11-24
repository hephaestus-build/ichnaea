import fc from "fast-check";
import { expect, it } from "vitest";

import { argumentsFor, type Command, jsonRequested } from "../../src/core/command-grammar.ts";

const command: Command = {
  name: "worker",
  description: "A command with worker arguments",
  options: { run: { type: "string", required: true, description: "Run ID" } },
  worker: true,
  run: () => ({ code: 0, text: [], json: null }),
};

it("passes the worker argv through unchanged and reserves JSON mode for registry flags", () => {
  fc.assert(
    fc.property(fc.array(fc.string(), { minLength: 1 }), (worker) => {
      const argv = ["--run", "fixture", "--", ...worker, "--json", "--run", "--"];
      expect(argumentsFor(command, argv).worker).toEqual(argv.slice(3));
      expect(jsonRequested(argv)).toBe(false);
      expect(jsonRequested(["--json", ...argv])).toBe(true);
      expect(() => argumentsFor(command, ["--run", "other", ...argv])).toThrow(/only be used once/);
    }),
  );
});

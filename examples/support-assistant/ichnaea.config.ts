import { defineConfig } from "@hephaestus-build/ichnaea-core";
import { decidePlugin } from "@hephaestus-build/ichnaea-decide";
import { reportPlugin } from "@hephaestus-build/ichnaea-report";

import { support } from "./plugin.ts";

export default defineConfig({
  plugins: [support, decidePlugin(), reportPlugin()],
  allowStability: ["alpha"],
});

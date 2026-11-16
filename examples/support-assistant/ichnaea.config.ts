import { decidePlugin, defineConfig, reportPlugin } from "@hephaestus-build/ichnaea";

import { support } from "./plugin.ts";

export default defineConfig({
  plugins: [support, decidePlugin(), reportPlugin()],
  allowStability: ["alpha"],
});

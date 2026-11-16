import { decidePlugin, defineConfig, reportPlugin } from "@tumaet/ichnaea";

import { support } from "./plugin.ts";

export default defineConfig({
  plugins: [support, decidePlugin(), reportPlugin()],
  allowStability: ["alpha"],
});

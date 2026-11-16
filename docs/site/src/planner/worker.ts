// Runs the simulations off the main thread, so the page stays responsive while they run.
import { plan, type PlannerRequest } from "./model.ts";

self.addEventListener("message", (event: MessageEvent<PlannerRequest>) => {
  // A worker posts to its own page: there is no target origin to name.
  // oxlint-disable-next-line unicorn/require-post-message-target-origin
  self.postMessage(plan(event.data));
});

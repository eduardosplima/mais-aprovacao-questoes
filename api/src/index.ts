import app from "./app";
import type { Env } from "./config/env";
import { reconcile } from "./jobs/reconcile";

export default {
  fetch: app.fetch,

  /** Cron `0 3 * * *` (00:00 BRT) — ver wrangler.jsonc. */
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    const stats = await reconcile(env);
    console.log("reconcile", stats);
  },
};

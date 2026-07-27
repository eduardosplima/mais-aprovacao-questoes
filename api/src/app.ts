import { Hono } from "hono";
import type { Env } from "./config/env";
import { auth } from "./routes/auth";
import { webhooks } from "./webhooks/hotmart";

export const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) => c.json({ ok: true }));
app.route("/auth", auth);
app.route("/webhooks", webhooks);

export default app;

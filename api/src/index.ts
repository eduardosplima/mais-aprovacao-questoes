import { Hono } from "hono";
import type { Env } from "./config/env";
import { auth } from "./routes/auth";

const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) => c.json({ ok: true }));
app.route("/auth", auth);

export default app;

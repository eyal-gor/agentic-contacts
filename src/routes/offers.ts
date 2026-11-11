import { Hono } from "hono";
import { z } from "zod";
import * as offers from "../offerstore.js";
import { requireApiKey } from "../auth.js";
import type { Env } from "../db.js";

// What you're selling someone. Used by the LinkedIn extension when you reach
// out, editable from the CLI. A contact carries `offer:<id>`.
export const offersRoute = new Hono<{ Bindings: Env }>();
offersRoute.use("*", requireApiKey);

const Input = z.object({
  id: z.string().min(1).max(60).optional(),
  name: z.string().min(1).max(120),
  pitch: z.string().max(600).optional(),
  icp: z.string().max(60).nullable().optional(),
});

offersRoute.get("/", async (c) => {
  const list = await offers.all(c.env.DB);
  return c.json({ offers: list, count: list.length });
});

offersRoute.post("/", async (c) => {
  const parsed = Input.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid", issues: parsed.error.issues }, 400);
  return c.json(await offers.create(c.env.DB, parsed.data), 201);
});

offersRoute.get("/:id", async (c) => {
  const o = await offers.get(c.env.DB, c.req.param("id"));
  return o ? c.json(o) : c.json({ error: "not found" }, 404);
});

offersRoute.patch("/:id", async (c) => {
  const parsed = Input.partial().safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid", issues: parsed.error.issues }, 400);
  const o = await offers.update(c.env.DB, c.req.param("id"), parsed.data);
  return o ? c.json(o) : c.json({ error: "not found" }, 404);
});

// Mark an offer as just used, so it sorts first next time.
offersRoute.post("/:id/used", async (c) => {
  const o = await offers.used(c.env.DB, c.req.param("id"));
  return o ? c.json(o) : c.json({ error: "not found" }, 404);
});

offersRoute.delete("/:id", async (c) => {
  return (await offers.remove(c.env.DB, c.req.param("id"))) ? c.body(null, 204) : c.json({ error: "not found" }, 404);
});

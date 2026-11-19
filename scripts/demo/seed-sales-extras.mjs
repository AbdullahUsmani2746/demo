// scripts/demo/seed-sales-extras.mjs — bring a demo database built before these
// steps existed up to date (a fresh build gets both from seed-documents.mjs):
//   0. customer price lists (scripts/demo/customerPriceLists.mjs)
//   1. Target Qty on Sales & Recovery Targets (scripts/demo/salesTargets.mjs)
//   2. the after-seed feature switches (DEMO_FEATURES_AFTER_SEED: credit-limit hold)
//   node --env-file=.env scripts/demo/seed-sales-extras.mjs [--base http://localhost:3000]
// Needs the app running against the demo database. Re-runnable (each save is an upsert).
import { PrismaClient } from "@prisma/client";
import { DEMO_PASSWORD } from "./seed-masters.mjs";
import { seedSalesTargets } from "./salesTargets.mjs";
import { seedCustomerPriceLists } from "./customerPriceLists.mjs";
import { applyDemoFeatures } from "./demoFeatures.mjs";

if (!(process.env.DEMO_DATABASE === "1" || process.env.DATABASE_URL?.includes("bizlogist_demo"))) {
  console.error("Refusing: DATABASE_URL is not the demo database.");
  process.exit(1);
}
const BASE = process.argv.includes("--base") ? process.argv[process.argv.indexOf("--base") + 1] : "http://localhost:3000";
const prisma = new PrismaClient();

const sessions = new Map();
async function login(username) {
  if (sessions.has(username)) return sessions.get(username);
  const jar = new Map();
  const keep = (res) => {
    for (const c of res.headers.getSetCookie?.() || []) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
  };
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  keep(csrfRes);
  const { csrfToken } = await csrfRes.json();
  const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookie() },
    body: new URLSearchParams({ csrfToken, email: username, password: DEMO_PASSWORD, callbackUrl: BASE, json: "true" }),
  });
  keep(res);
  if (![...jar.keys()].some((k) => k.includes("session-token"))) throw new Error(`login failed for ${username}`);
  const s = { cookie };
  sessions.set(username, s);
  return s;
}

async function call(username, method, path, body) {
  const s = await login(username);
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json", cookie: s.cookie() },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (res.status === 403 && username !== "admin") return call("admin", method, path, body);
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${json?.error || res.statusText}`);
  return json;
}

await seedCustomerPriceLists({ call, prisma });
await seedSalesTargets({ call, prisma, from: new Date("2026-06-01T00:00:00Z"), to: new Date() });
await applyDemoFeatures(call, console.log, { afterSeed: true });
await prisma.$disconnect();

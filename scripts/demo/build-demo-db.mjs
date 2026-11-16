// scripts/demo/build-demo-db.mjs — rebuild the Bizlogist ERP demo database from nothing.
// ============================================================
//   node --env-file=.env scripts/demo/build-demo-db.mjs            # schema + setup + masters
//   node --env-file=.env scripts/demo/build-demo-db.mjs --data     # … then documents (app must be running)
//
// Steps:
//   1. drop and recreate the public schema            (demo database ONLY)
//   2. prisma db push                                  (tables from schema.prisma)
//   3. prisma/sql/*.sql in date order                  (triggers, permissions, roles, settings)
//   4. scripts/demo/fresh-db-fixups.sql                (objects the live DB has outside prisma/sql)
//   5. menus, permission catalogue, role templates, BI dashboards
//   6. scripts/demo/seed-masters.mjs                   (made-up company, chart, items, people, logins)
//   7. --data: scripts/demo/seed-documents.mjs         (orders, GRNs, dispatches, invoices, vouchers, HR)
//
// The database runs in Docker: docker compose -f docker-compose.demo.yml up -d
// ============================================================
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const url = process.env.DATABASE_URL || "";
if (!(process.env.DEMO_DATABASE === "1" || url.includes("bizlogist_demo"))) {
  console.error("Refusing: DATABASE_URL is not the demo database (bizlogist_demo).");
  process.exit(1);
}
// psql runs inside the local Docker container, so the database it resets is
// the one DATABASE_URL names — and it must be on this machine (never a server).
let DB_NAME;
try {
  const u = new URL(url);
  DB_NAME = decodeURIComponent(u.pathname.replace(/^\//, "")) || "bizlogist_demo";
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(u.hostname)) {
    console.error(`Refusing: DATABASE_URL host ${u.hostname} is not local — the demo database runs in Docker on this machine.`);
    process.exit(1);
  }
} catch {
  console.error("Refusing: DATABASE_URL is not a valid postgresql:// URL.");
  process.exit(1);
}
const CONTAINER = process.env.DEMO_DB_CONTAINER || "bizlogist-demo-db";
const isWin = process.platform === "win32";
const npx = isWin ? "npx.cmd" : "npx";

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: "inherit", shell: isWin, ...opts });
const psql = (sql, { strict = true } = {}) =>
  execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "demo", "-d", DB_NAME, "-q", ...(strict ? ["-v", "ON_ERROR_STOP=1"] : [])], {
    input: sql,
    stdio: ["pipe", "pipe", "pipe"],
  }).toString();
const step = (msg) => console.log(`\n▶ ${msg}`);

// A prisma/sql file that creates tables `db push` already made fails on its
// first CREATE TABLE. Re-run it tolerant: IF NOT EXISTS on tables / indexes /
// columns, and foreign keys skipped (db push created them).
function tolerant(sql) {
  return sql
    .replace(/CREATE TABLE (?!IF NOT EXISTS)/g, "CREATE TABLE IF NOT EXISTS ")
    .replace(/CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/g, "CREATE $1INDEX IF NOT EXISTS ")
    .replace(/ADD COLUMN (?!IF NOT EXISTS)/g, "ADD COLUMN IF NOT EXISTS ")
    .replace(/^ALTER TABLE [^;]+ADD CONSTRAINT [^;]+FOREIGN KEY[^;]+;/gm, "-- (foreign key created by db push)")
    .replace(/^CREATE TYPE [^;]+;/gm, "-- (type created by db push)");
}

step(`1. reset schema (${DB_NAME})`);
psql("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");

step("2. prisma db push");
run(npx, ["prisma", "db", "push", "--skip-generate", "--accept-data-loss"]);

step("3. prisma/sql");
const sqlDir = "prisma/sql";
const files = fs.readdirSync(sqlDir).filter((f) => f.endsWith(".sql")).sort();
const rolesFile = "2026-11-16_roles.sql";
for (const f of files.filter((x) => x !== rolesFile)) {
  const sql = fs.readFileSync(path.join(sqlDir, f), "utf8");
  try {
    psql(sql);
    console.log(`  ok        ${f}`);
  } catch {
    try {
      psql(tolerant(sql));
      console.log(`  ok (tol.) ${f}`);
    } catch (e) {
      console.log(`  FAILED    ${f}\n${String(e.stderr || e.message).split("\n").slice(0, 4).join("\n")}`);
      process.exitCode = 1;
    }
  }
}

step("4. fresh-db fixups");
psql(fs.readFileSync("scripts/demo/fresh-db-fixups.sql", "utf8"));

step("5. menus, permissions, roles, BI dashboards");
psql(fs.readFileSync("scripts/sql/menus-seed.sql", "utf8"));
run("node", ["--env-file=.env", "scripts/seed-permissions.mjs", "--apply"], { stdio: ["ignore", "ignore", "inherit"] });
// Role templates are granted from the permission catalogue, so they run after it.
psql(fs.readFileSync(path.join(sqlDir, rolesFile), "utf8"));
// Files that grant permissions to roles, re-run now the roles exist (all re-runnable).
for (const f of files) {
  if (f === rolesFile) continue;
  try { psql(tolerant(fs.readFileSync(path.join(sqlDir, f), "utf8")), { strict: false }); } catch { /* already applied */ }
}
run("node", ["--env-file=.env", "scripts/seed-bi-dashboards.mjs", "--apply"], { stdio: ["ignore", "ignore", "inherit"] });

step("6. master data");
run("node", ["--env-file=.env", "scripts/demo/seed-masters.mjs"]);

if (process.argv.includes("--data")) {
  step("7. documents (through the running app)");
  run("node", ["--env-file=.env", "scripts/demo/seed-documents.mjs"]);
}

console.log("\nDemo database ready. Logins: see scripts/demo/README.md (password demo123).");

import "dotenv/config";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { prisma } from "../db";

/**
 * Schema changes live in migrations/*.sql, numbered, applied once each and recorded in schema_migrations.
 * Run "pnpm migrate" in the deploy build, so no code ever changes the schema at runtime.
 */
async function main(): Promise<void> {
  await prisma.$executeRawUnsafe("create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())");
  const applied = new Set((await prisma.$queryRawUnsafe<any[]>("select name from schema_migrations")).map((r) => String(r.name)));
  const dir = join(process.cwd(), "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  let n = 0;
  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = readFileSync(join(dir, f), "utf8").split(/\r?\n/).filter((l) => !l.trim().startsWith("--")).join("\n");
    for (const statement of sql.split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean)) await prisma.$executeRawUnsafe(statement);
    await prisma.$executeRawUnsafe("insert into schema_migrations (name) values ($1)", f);
    console.log("applied " + f);
    n++;
  }
  console.log(n ? n + " migration(s) applied" : "database is up to date (" + files.length + " known)");
}

main().catch((e) => { console.error("migration failed:", e instanceof Error ? e.message : String(e)); process.exitCode = 1; }).finally(() => process.exit());

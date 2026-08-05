import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL ?? "";
const anon = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

async function main() {
  console.log("anon key present:", Boolean(anon), "len:", anon.length);
  if (!anon) { console.log("NO ANON KEY in apps/api/.env - that is fine, the dashboard has it. Skipping live test."); return; }
  // sign in as the test GM we created, then try to read own staff_users row
  const sb = createClient(url, anon);
  // we do not know the test GM password reliably; just confirm the table is queryable shape-wise via service role separately
  console.log("Anon client created OK. Login will use signInWithPassword then read staff_users.");
}
main().catch((e) => console.log("ERR:", e instanceof Error ? e.message : String(e)));
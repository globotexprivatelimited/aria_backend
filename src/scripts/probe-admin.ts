import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
const url = process.env.SUPABASE_URL ?? "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
async function main() {
  console.log("url:", Boolean(url), "key starts:", key.slice(0, 10), "len:", key.length);
  const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await admin.auth.admin.createUser({
    email: "probe-" + Date.now() + "@aria.local",
    password: "probe-pw-12345",
    email_confirm: true,
  });
  if (error) { console.log("NOWORK:", error.message); return; }
  console.log("WORKED - user id:", data.user?.id);
  if (data.user?.id) await admin.auth.admin.deleteUser(data.user.id);
}
main().catch((e) => console.log("ERR:", e instanceof Error ? e.message : String(e)));
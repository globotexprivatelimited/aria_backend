import "dotenv/config";

const URL = process.env.SUPABASE_URL ?? "";
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

async function main() {
  console.log("URL present:", Boolean(URL), "| KEY present:", Boolean(KEY), "| KEY prefix:", KEY.slice(0, 10));
  if (!URL || !KEY) { console.log("Missing env - check apps/api/.env"); return; }

  const res = await fetch(URL + "/auth/v1/admin/users", {
    method: "POST",
    headers: { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: "onboarding-test@aria.local", password: "test-pw-12345", email_confirm: true }),
  });
  const body = await res.json();
  console.log("status:", res.status);
  console.log("response:", JSON.stringify(body).slice(0, 240));
  if (res.ok && body.id) {
    console.log("\nSUCCESS - service key works for account creation. Test user id:", body.id);
    // clean up the test user
    await fetch(URL + "/auth/v1/admin/users/" + body.id, { method: "DELETE", headers: { apikey: KEY, Authorization: "Bearer " + KEY } });
    console.log("Test user deleted. Ready to build the real endpoints.");
  } else {
    console.log("\nDID NOT WORK - we may need the legacy service_role JWT instead of the sb_secret_ key.");
  }
}

main().catch(console.error);
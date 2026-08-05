import "dotenv/config";
import { prisma } from "../db";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

// ---- EDIT THESE, then run ----
const EMAIL = "spa@demo.com";
const PASSWORD = "demo12345";
const ROLE = "spa";          // founder | gm | fb | housekeeping | spa | front_desk
const HOTEL_ID = "demo";
const FULL_NAME = "Spa Desk";
// ------------------------------

async function main() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.log("Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to apps/api/.env first.");
    return;
  }
  const res = await fetch(SUPABASE_URL + "/auth/v1/admin/users", {
    method: "POST",
    headers: { apikey: SERVICE_KEY, Authorization: "Bearer " + SERVICE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, email_confirm: true }),
  });
  const body = (await res.json()) as { id?: string; msg?: string; error_description?: string };
  if (!res.ok || !body.id) {
    console.log("Auth create failed:", res.status, JSON.stringify(body).slice(0, 160));
    return;
  }
  await prisma.$executeRawUnsafe(
    'insert into staff_users (auth_user_id, hotel_id, role, full_name) values ($1,$2,$3,$4) on conflict (auth_user_id) do update set role = $3, hotel_id = $2, full_name = $4',
    body.id, HOTEL_ID, ROLE, FULL_NAME
  );
  console.log("Staff login created:");
  console.log("  email:   " + EMAIL);
  console.log("  password:" + PASSWORD);
  console.log("  role:    " + ROLE + "  hotel: " + HOTEL_ID);
}

main().catch(console.error).finally(() => prisma.$disconnect());

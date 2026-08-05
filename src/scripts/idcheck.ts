import "dotenv/config";
import { prisma } from "../db";
async function main() {
  // what id does the admin/staff endpoint return vs staff_users.id?
  const su: any[] = await prisma.$queryRawUnsafe(`select id, full_name from staff_users where hotel_id='1' limit 3`);
  console.log("STAFF_USERS ids:", JSON.stringify(su.map((s:any)=>({id:s.id, name:s.full_name}))));
  // the link table references staff_user_id - do those match staff_users.id?
  const sd: any[] = await prisma.$queryRawUnsafe(`select distinct staff_user_id from staff_departments limit 3`);
  console.log("STAFF_DEPT references:", JSON.stringify(sd.map((s:any)=>s.staff_user_id)));
  // do they match?
  const suIds = su.map((s:any)=>s.id);
  const sdIds = sd.map((s:any)=>s.staff_user_id);
  console.log("IDS MATCH:", sdIds.every((id:string)=>suIds.includes(id)) || "some differ - check");
}
main().catch(e=>console.log("ERR",e.message)).finally(()=>prisma.$disconnect());
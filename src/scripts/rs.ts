import "dotenv/config";
import { prisma } from "../db";
async function main() {
  const total: any[] = await prisma.$queryRawUnsafe(`select count(*) n from rooms where hotel_id='1'`);
  const occ: any[] = await prisma.$queryRawUnsafe(`select count(*) n from rooms where hotel_id='1' and status='occupied'`);
  const sample: any[] = await prisma.$queryRawUnsafe(`select room_number, guest_name, check_out from rooms where hotel_id='1' and status='occupied' limit 2`);
  console.log("RESULT >>> total rooms:", total[0].n, "| occupied:", occ[0].n);
  console.log("RESULT >>> sample occupied:", JSON.stringify(sample.map((r:any)=>({rm:r.room_number,g:r.guest_name,co:r.check_out}))));
}
main().catch(e=>console.log("ERR",e.message)).finally(()=>prisma.$disconnect());
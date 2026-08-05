import "dotenv/config";
import { prisma } from "../db";
async function main() {
  const co18 = new Date(Date.now() + 18*3600*1000).toISOString();
  const co2d = new Date(Date.now() + 48*3600*1000).toISOString();
  const co4 = new Date(Date.now() + 4*3600*1000).toISOString();
  const guests: [string,string,number,string][] = [["101","A. Sharma",2,co18],["305","R. Patel",1,co2d],["1203","M. Khan",4,co4],["807","S. Iyer",2,co18],["402","N. Reddy",3,co2d]];
  for (const [rm,g,p,co] of guests) {
    await prisma.$executeRawUnsafe(`update rooms set status='occupied', guest_name=$2, party_size=$3, check_in=now(), check_out=$4::timestamptz where hotel_id='1' and room_number=$1`, rm, g, p, co);
  }
  await prisma.$executeRawUnsafe(`update rooms set status='cleaning' where hotel_id='1' and room_number in ('202','606')`);
  const occ: any[] = await prisma.$queryRawUnsafe(`select status, count(*) n from rooms where hotel_id='1' group by status`);
  console.log("RESULT >>> statuses:", JSON.stringify(occ.map((r:any)=>({s:r.status,n:Number(r.n)}))));
}
main().catch(e=>console.log("ERR",e.message)).finally(()=>prisma.$disconnect());
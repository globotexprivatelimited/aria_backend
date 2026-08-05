import "dotenv/config";
import { prisma } from "../db";
async function main() {
  // orders: real revenue?
  const o: any[] = await prisma.$queryRawUnsafe(`select count(*) as n, coalesce(sum(total),0) as rev, coalesce(avg(total),0) as avg from orders`);
  console.log("RESULT >>> orders:", "count="+o[0].n, "totalRev="+o[0].rev, "avg="+Math.round(Number(o[0].avg)));
  // orders by hotel + status
  try {
    const bh: any[] = await prisma.$queryRawUnsafe(`select hotel_id, status::text as st, count(*) as n, coalesce(sum(total),0) as rev from orders group by hotel_id, status order by hotel_id`);
    console.log("RESULT >>> orders by hotel/status:", JSON.stringify(bh.map((r:any)=>({h:r.hotel_id,st:r.st,n:Number(r.n),rev:Number(r.rev)}))));
  } catch(e){ console.log("orders group err", (e as Error).message.slice(0,50)); }
  // DiningBooking columns + count
  const dbc: any[] = await prisma.$queryRawUnsafe(`select column_name from information_schema.columns where table_name='DiningBooking' order by ordinal_position`);
  console.log("RESULT >>> DiningBooking cols:", dbc.map((c:any)=>c.column_name).join(","));
  const db: any[] = await prisma.$queryRawUnsafe(`select count(*) as n from "DiningBooking"`);
  console.log("RESULT >>> DiningBooking count:", db[0].n);
  // ActivityBooking columns + count
  const abc: any[] = await prisma.$queryRawUnsafe(`select column_name from information_schema.columns where table_name='ActivityBooking' order by ordinal_position`);
  console.log("RESULT >>> ActivityBooking cols:", abc.map((c:any)=>c.column_name).join(","));
  const ab: any[] = await prisma.$queryRawUnsafe(`select count(*) as n from "ActivityBooking"`);
  console.log("RESULT >>> ActivityBooking count:", ab[0].n);
  // order_items - are line items recorded?
  const oic: any[] = await prisma.$queryRawUnsafe(`select column_name from information_schema.columns where table_name='order_items' order by ordinal_position`);
  console.log("RESULT >>> order_items cols:", oic.map((c:any)=>c.column_name).join(","));
}
main().catch(e=>console.log("ERR >>>",e.message)).finally(()=>prisma.$disconnect());
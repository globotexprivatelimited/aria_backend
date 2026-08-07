import "dotenv/config";
import { prisma } from "../db";
async function main() {
  const c: any[] = await prisma.$queryRawUnsafe(`select unnest(enum_range(null::"RequestCategory"))::text v`);
  console.log("RequestCategory:", c.map((x:any)=>x.v).join(", "));
  const d: any[] = await prisma.$queryRawUnsafe(`select unnest(enum_range(null::"Department"))::text v`);
  console.log("Department:", d.map((x:any)=>x.v).join(", "));
}
main().catch((e)=>console.log("ERR", e.message)).finally(()=>prisma.$disconnect());
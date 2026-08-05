import "dotenv/config";
import { prisma } from "../db";
async function main() {
  // unique constraints on Session
  const uq: any[] = await prisma.$queryRawUnsafe(`
    select tc.constraint_type, string_agg(kcu.column_name, ',') cols
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu on tc.constraint_name=kcu.constraint_name
    where tc.table_name='Session' and tc.constraint_type in ('PRIMARY KEY','UNIQUE')
    group by tc.constraint_type, tc.constraint_name`);
  console.log("RESULT >>> Session constraints:", JSON.stringify(uq.map((r:any)=>({t:r.constraint_type,c:r.cols}))));
  // state enum values
  const en: any[] = await prisma.$queryRawUnsafe(`select unnest(enum_range(null::"SessionState"))::text as v`).catch(async()=>{
    const t: any[] = await prisma.$queryRawUnsafe(`select data_type, udt_name from information_schema.columns where table_name='Session' and column_name='state'`);
    return [{v:"(enum type: "+(t[0]?.udt_name||"?")+")"}];
  });
  console.log("RESULT >>> state values:", en.map((r:any)=>r.v).join(","));
  // id column - default?
  const idc: any[] = await prisma.$queryRawUnsafe(`select column_name, column_default, is_nullable from information_schema.columns where table_name='Session' and column_name in ('id','hotelId','guestPhone','state','createdAt','updatedAt','lastMessageAt') order by ordinal_position`);
  console.log("RESULT >>> key col defaults:", JSON.stringify(idc.map((r:any)=>({c:r.column_name,d:r.column_default?"has-default":"NO-DEFAULT",null:r.is_nullable}))));
}
main().catch(e=>console.log("ERR",e.message)).finally(()=>prisma.$disconnect());
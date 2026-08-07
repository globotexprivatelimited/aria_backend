import "dotenv/config";
import { prisma } from "../db";
async function main() {
  const h: any[] = await prisma.$queryRawUnsafe(
    `select h."hotelId" id, h.name, h.city, h.contact_email,
            (select count(*)::int from rooms r where r.hotel_id=h."hotelId") rooms,
            (select count(*)::int from "Request" q where q."hotelId"=h."hotelId") reqs,
            (select count(*)::int from staff_users s where s.hotel_id=h."hotelId") staff,
            h."createdAt"
       from "Hotel" h order by h."createdAt"`);
  h.forEach((x:any)=>console.log(
    "  hotel " + x.id + " | " + x.name + " | " + (x.city ?? "-") +
    " | " + x.rooms + " rooms, " + x.reqs + " reqs, " + x.staff + " staff | " + x.contact_email));
}
main().catch((e)=>console.log("ERR", e.message)).finally(()=>prisma.$disconnect());

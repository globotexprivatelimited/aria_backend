import "dotenv/config";
import { prisma } from "../db";

const statements = [
  // ORDERS - a guest order against the menu
  `create table if not exists orders (
    id uuid primary key default gen_random_uuid(),
    hotel_id text not null,
    dept text not null,
    room text,
    guest_phone text,
    status text not null default 'placed',   -- placed | preparing | delivered | cancelled
    total numeric(10,2) not null default 0,
    created_at timestamptz default now()
  )`,
  `create index if not exists orders_hotel on orders (hotel_id, created_at desc)`,
  `alter table orders enable row level security`,
  `drop policy if exists "staff manage own orders" on orders`,
  `create policy "staff manage own orders" on orders for all to authenticated
     using (exists (select 1 from staff_users s where s.auth_user_id = auth.uid() and s.hotel_id = orders.hotel_id))
     with check (exists (select 1 from staff_users s where s.auth_user_id = auth.uid() and s.hotel_id = orders.hotel_id))`,

  `create table if not exists order_items (
    id uuid primary key default gen_random_uuid(),
    order_id uuid not null references orders(id) on delete cascade,
    menu_item_id uuid,
    name text not null,
    unit_price numeric(10,2) not null default 0,
    qty integer not null default 1
  )`,
  `alter table order_items enable row level security`,
  `drop policy if exists "staff manage own order_items" on order_items`,
  `create policy "staff manage own order_items" on order_items for all to authenticated
     using (exists (select 1 from orders o join staff_users s on s.hotel_id = o.hotel_id where o.id = order_items.order_id and s.auth_user_id = auth.uid()))
     with check (true)`,

  // ATOMIC STOCK DECREMENT - race-safe: only succeeds if enough stock; flips available=false at zero
  `create or replace function decrement_stock(p_item uuid, p_qty integer)
   returns TABLE(ok boolean, new_stock integer, low boolean) language plpgsql as $$
   declare cur integer; thresh integer;
   begin
     select stock, low_stock_at into cur, thresh from menu_items where id = p_item for update;
     if cur is null then return query select false, 0, false; return; end if;
     if cur < p_qty then return query select false, cur, (cur <= thresh); return; end if;
     update menu_items set stock = stock - p_qty,
        available = case when (stock - p_qty) <= 0 then false else available end
      where id = p_item;
     select stock into cur from menu_items where id = p_item;
     return query select true, cur, (cur <= thresh);
   end $$`,
];
async function main() {
  for (const sql of statements) {
    try { await prisma.$executeRawUnsafe(sql); console.log("ok  :", sql.replace(/\s+/g," ").slice(0, 55)); }
    catch (e) { console.log("note:", (e instanceof Error ? e.message : String(e)).slice(0, 70)); }
  }
  console.log("\norders + order_items + decrement_stock() ready.");
}
main().catch(console.error).finally(() => prisma.$disconnect());
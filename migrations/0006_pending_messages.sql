create table if not exists pending_messages (id uuid primary key default gen_random_uuid(), hotel_id text not null, guest_phone text not null, body text not null, reason text, created_at timestamptz not null default now(), sent_at timestamptz);
create index if not exists pending_messages_open_idx on pending_messages (hotel_id, guest_phone) where sent_at is null;
create table if not exists reengagements (id uuid primary key default gen_random_uuid(), hotel_id text not null, guest_phone text not null, template text not null, sent_at timestamptz not null default now());
create index if not exists reengagements_guest_idx on reengagements (hotel_id, guest_phone, sent_at desc);

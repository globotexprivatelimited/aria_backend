create table if not exists dept_config_history (id uuid primary key default gen_random_uuid(), hotel_id text not null, dept text not null, mode text not null, changed_by text, changed_at timestamptz not null default now());
create index if not exists dept_config_history_hotel_idx on dept_config_history (hotel_id, changed_at desc);

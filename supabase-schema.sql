create table if not exists public.brewberry_orders (
  id uuid primary key,
  tracking_code text not null unique,
  phone text not null,
  status text not null,
  payment_status text not null,
  total integer not null,
  currency text not null default 'INR',
  items jsonb not null,
  data jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists brewberry_orders_tracking_code_idx
  on public.brewberry_orders (tracking_code);

create table if not exists public.brewberry_messages (
  id uuid primary key,
  name text not null,
  email text not null,
  message text not null,
  created_at timestamptz not null default now()
);

alter table public.brewberry_orders enable row level security;
alter table public.brewberry_messages enable row level security;

-- Additive extension of the existing proposals table. Legacy columns/rows are preserved.
alter table public.propostas
  add column if not exists data_inicio date,
  add column if not exists materiais text,
  add column if not exists garantia_prazo text,
  add column if not exists garantia_tipo text,
  add column if not exists garantia_condicoes text,
  add column if not exists portfolio jsonb not null default '[]'::jsonb,
  add column if not exists payload_hash text,
  add column if not exists data_criacao timestamptz not null default now();

alter table public.propostas drop constraint if exists ck_propostas_portfolio;
alter table public.propostas add constraint ck_propostas_portfolio
  check (jsonb_typeof(portfolio) = 'array' and jsonb_array_length(portfolio) <= 5);
-- Access continues through the authenticated Node API, using the existing database connection.
alter table public.propostas enable row level security;

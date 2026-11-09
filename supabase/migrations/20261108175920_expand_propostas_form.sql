-- Additive extension of the existing proposals table. Legacy columns/rows are preserved.
alter table public.propostas
  add column data_inicio date,
  add column materiais text,
  add column garantia_prazo text,
  add column garantia_tipo text,
  add column garantia_condicoes text,
  add column portfolio jsonb not null default '[]'::jsonb,
  add column payload_hash text,
  add column data_criacao timestamptz not null default now();

alter table public.propostas add constraint ck_propostas_portfolio
  check (jsonb_typeof(portfolio) = 'array' and jsonb_array_length(portfolio) <= 5);
-- Access continues through the authenticated Node API, using the existing database connection.
alter table public.propostas enable row level security;

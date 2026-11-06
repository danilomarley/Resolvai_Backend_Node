-- #92: uma avaliação por pedido, inclusive em requisições concorrentes.
create table if not exists public.avaliacoes (
    id_pedido uuid primary key references public.pedidos(id),
    id_cliente uuid not null references public.users(id),
    id_prestador uuid not null references public.users(id),
    nota smallint not null check (nota between 1 and 5),
    comentario text check (char_length(comentario) <= 2000),
    data_criacao timestamptz not null default now()
);
create index if not exists ix_avaliacoes_prestador_data on public.avaliacoes(id_prestador, data_criacao desc);
create index if not exists ix_avaliacoes_cliente on public.avaliacoes(id_cliente);
-- Leituras/escritas passam pela autorização da API; sem acesso direto pelo cliente Supabase.
alter table public.avaliacoes enable row level security;

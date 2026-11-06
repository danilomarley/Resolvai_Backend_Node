-- 016_create_perfil_prestador.sql
-- Perfil profissional do prestador (D1/D2: cadastro livre, sem documentos nesta etapa):
--   prestador_categorias: categorias em que ele atua (catálogo do script 015)
--   prestador_regioes:    cidades que ele atende (texto livre, comparado sem acento/maiúsculas)
-- Pedido "compatível" = categoria do pedido está nas do prestador E a cidade do pedido está nas dele.
-- Depende do 015. Idempotente.

create table if not exists public.prestador_categorias (
    id_prestador  uuid  not null references public.users (id) on delete cascade,
    id_categoria  uuid  not null references public.categorias_servico (id),
    primary key (id_prestador, id_categoria)
);

create table if not exists public.prestador_regioes (
    id            uuid  primary key default gen_random_uuid(),
    id_prestador  uuid  not null references public.users (id) on delete cascade,
    cidade        text  not null,
    constraint ck_prestador_regioes_cidade check (char_length(btrim(cidade)) between 2 and 80)
);

create unique index if not exists uq_prestador_regioes_cidade
    on public.prestador_regioes (id_prestador, public.resolvai_norm(cidade));

alter table public.prestador_categorias enable row level security;
alter table public.prestador_regioes enable row level security;

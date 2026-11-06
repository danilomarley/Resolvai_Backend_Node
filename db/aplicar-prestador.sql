-- Scripts 015, 016 e 017 juntos (ver docs/PRESTADOR.md). Idempotentes; rode no SQL Editor do Supabase.

-- 015_create_categorias_servico.sql
-- Catálogo de categorias de serviço (D6 do app do prestador): é a lista que o prestador escolhe no cadastro
-- e que o feed usa para marcar pedidos "compatíveis". A carga inicial está no final deste script e pode ser
-- editada à vontade: o conteúdo do catálogo é só dado. Idempotente (pode rodar de novo; não duplica nem apaga).
--
-- Também cria public.resolvai_norm(texto): minúsculas e sem acentos, usada para comparar categoria e cidade
-- de forma tolerante ("Elétrica" = "eletrica", "Fortaleza/CE" contém "fortaleza").

create or replace function public.resolvai_norm(texto text) returns text
language sql immutable as $$
  select translate(lower(coalesce(texto, '')), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc')
$$;

create table if not exists public.categorias_servico (
    id     uuid     primary key default gen_random_uuid(),
    slug   text     not null,
    nome   text     not null,
    ativo  boolean  not null default true,
    ordem  integer  not null default 0,
    constraint uq_categorias_servico_slug unique (slug)
);

-- Acesso só pela API (conexão do servidor); sem acesso direto pelo cliente do Supabase.
alter table public.categorias_servico enable row level security;

insert into public.categorias_servico (slug, nome, ordem) values
    ('eletrica',               'Elétrica',                      10),
    ('hidraulica',             'Hidráulica',                    20),
    ('impermeabilizacao',      'Impermeabilização',             30),
    ('alvenaria',              'Alvenaria',                     40),
    ('pintura',                'Pintura',                       50),
    ('gesso-e-forro',          'Gesso e forro',                 60),
    ('pisos-e-revestimentos',  'Pisos e revestimentos',         70),
    ('telhados-e-coberturas',  'Telhados e coberturas',         80),
    ('marcenaria',             'Marcenaria',                    90),
    ('serralheria',            'Serralheria',                  100),
    ('vidracaria',             'Vidraçaria',                   110),
    ('ar-condicionado',        'Ar-condicionado',              120),
    ('jardinagem',             'Jardinagem e paisagismo',      130),
    ('limpeza-pos-obra',       'Limpeza pós-obra',             140),
    ('montagem-de-moveis',     'Montagem de móveis',           150),
    ('dedetizacao',            'Dedetização',                  160),
    ('reformas-em-geral',      'Reformas em geral',            170),
    ('outros',                 'Outros serviços',              999)
on conflict (slug) do nothing;


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


-- 017_alter_propostas_status_e_unicidade.sql
-- Aceite de proposta (Resolvai_Cliente#84) e envio pelo prestador:
--   * novo status 'nao_escolhida' (as demais propostas do pedido quando uma é escolhida);
--   * no máximo UMA proposta por pedido e prestador;
--   * no máximo UMA proposta 'escolhida' por pedido.
-- Os índices são criados dentro de blocos que só avisam se já houver dados duplicados (corrija os dados e
-- rode de novo). Idempotente.

alter table public.propostas drop constraint if exists ck_propostas_status;
alter table public.propostas add constraint ck_propostas_status
    check (status in ('enviada', 'visualizada', 'escolhida', 'nao_escolhida'));

do $$
begin
    create unique index if not exists uq_propostas_pedido_prestador
        on public.propostas (id_pedido, id_prestador);
exception when unique_violation then
    raise notice 'uq_propostas_pedido_prestador não criado: já existem propostas duplicadas (mesmo pedido e prestador).';
end $$;

do $$
begin
    create unique index if not exists uq_propostas_escolhida_por_pedido
        on public.propostas (id_pedido) where status = 'escolhida';
exception when unique_violation then
    raise notice 'uq_propostas_escolhida_por_pedido não criado: há pedidos com mais de uma proposta escolhida.';
end $$;



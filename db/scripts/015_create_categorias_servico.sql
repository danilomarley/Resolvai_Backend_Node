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

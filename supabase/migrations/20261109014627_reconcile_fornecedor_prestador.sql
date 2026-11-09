-- Complements proposals/reviews using the existing supplier tables as the canonical profile.
-- Apply through the normal migration workflow after reviewing the target schema.
begin;

create table if not exists public.fornecedores (
    id_usuario             uuid          primary key references public.users (id) on delete restrict,
    tipo_pessoa            varchar(2)    not null,
    nome_exibicao          text          not null,
    cnpj                   varchar(14),
    bio                    text,
    cidade_atuacao         text          not null,
    uf_atuacao             varchar(2)    not null,
    raio_atendimento_km    integer       not null default 20,
    registro_profissional  text,
    created_at             timestamptz   not null default now(),
    updated_at             timestamptz,
    constraint ck_fornecedores_tipo_pessoa check (tipo_pessoa in ('PF', 'PJ')),
    constraint ck_fornecedores_documento check (
        (tipo_pessoa = 'PF' and cnpj is null)
        or (tipo_pessoa = 'PJ' and cnpj is not null and cnpj ~ '^[A-Z0-9]{12}[0-9]{2}$')
    ),
    constraint uq_fornecedores_cnpj unique (cnpj),
    constraint ck_fornecedores_nome_exibicao check (btrim(nome_exibicao) <> ''),
    constraint ck_fornecedores_bio_tamanho check (bio is null or char_length(bio) <= 360),
    constraint ck_fornecedores_cidade check (btrim(cidade_atuacao) <> ''),
    constraint ck_fornecedores_uf check (uf_atuacao in (
        'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO',
        'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI',
        'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'
    )),
    constraint ck_fornecedores_raio check (raio_atendimento_km between 1 and 200),
    constraint ck_fornecedores_registro check (
        registro_profissional is null
        or (btrim(registro_profissional) <> '' and char_length(registro_profissional) <= 80)
    )
);

alter table public.fornecedores enable row level security;
revoke all privileges on table public.fornecedores from public, anon, authenticated;



create table if not exists public.especialidades (
    codigo       text         primary key,
    nome         text         not null,
    is_active    boolean      not null default true,
    created_at   timestamptz  not null default now(),
    constraint ck_especialidades_codigo check (codigo ~ '^[a-z][a-z0-9_]*$'),
    constraint ck_especialidades_nome check (btrim(nome) <> '')
);

-- Evita nomes equivalentes com diferencas apenas de maiusculas/minusculas.
create unique index if not exists uq_especialidades_nome_lower on public.especialidades (lower(nome));

create table if not exists public.fornecedor_especialidades (
    id_usuario            uuid         not null references public.fornecedores (id_usuario) on delete cascade,
    codigo_especialidade  text         not null references public.especialidades (codigo) on delete restrict,
    created_at            timestamptz  not null default now(),
    constraint pk_fornecedor_especialidades primary key (id_usuario, codigo_especialidade)
);

create index if not exists ix_fornecedor_especialidades_codigo on public.fornecedor_especialidades (codigo_especialidade);

alter table public.especialidades enable row level security;
alter table public.fornecedor_especialidades enable row level security;
revoke all privileges on table public.especialidades from public, anon, authenticated;
revoke all privileges on table public.fornecedor_especialidades from public, anon, authenticated;

insert into public.especialidades (codigo, nome) values
    ('hidraulica', 'Hidráulica'),
    ('eletrica', 'Elétrica'),
    ('impermeabilizacao', 'Impermeabilização'),
    ('pintura', 'Pintura'),
    ('alvenaria', 'Alvenaria'),
    ('serralheria', 'Serralheria') on conflict (codigo) do nothing;


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

-- 014_alter_propostas_data_e_prazo.sql
-- #83: a lista de propostas mostra a data de envio e ordena por prazo.
--   data_criacao: quando a proposta foi enviada. Linhas já existentes recebem a data em que este script rodou.
--   prazo_dias:   prazo numérico, alinhado com a equipe do prestador. O texto livre de `prazo` continua
--                 existindo para exibição; a ordenação por prazo usa só prazo_dias (nulos ficam por último).
-- Aditivo e idempotente: quem insere propostas sem esses campos continua funcionando.

alter table public.propostas add column if not exists data_criacao timestamptz not null default now();
alter table public.propostas add column if not exists prazo_dias integer;

alter table public.propostas drop constraint if exists ck_propostas_prazo_dias;
alter table public.propostas add constraint ck_propostas_prazo_dias check (prazo_dias is null or prazo_dias > 0);

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

-- Preserve uniqueness per role, including databases that still have the original CPF constraint.
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid='public.users'::regclass and conname='uq_users_cpf_role') then
    alter table public.users add constraint uq_users_cpf_role unique (cpf,role);
  end if;
end $$;
alter table public.users drop constraint if exists uq_users_cpf;

alter table public.propostas drop constraint if exists ck_propostas_status;
alter table public.propostas add constraint ck_propostas_status
  check (status in ('enviada','visualizada','escolhida','nao_escolhida'));
-- Fail safely if historical duplicates require manual reconciliation; never delete business records.
create unique index if not exists uq_propostas_pedido_prestador on public.propostas(id_pedido,id_prestador);
create unique index if not exists uq_propostas_escolhida_por_pedido on public.propostas(id_pedido) where status='escolhida';
update public.propostas set prazo_dias=substring(btrim(prazo) from '^([0-9]+)[ ]+dias?$')::integer
 where prazo_dias is null and btrim(prazo) ~ '^[0-9]{1,3}[ ]+dias?$'
   and substring(btrim(prazo) from '^([0-9]+)[ ]+dias?$')::integer between 1 and 365;

revoke all privileges on table public.avaliacoes from public,anon,authenticated;
commit;

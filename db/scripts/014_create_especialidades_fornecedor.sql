begin;

create table public.especialidades (
    codigo       text         primary key,
    nome         text         not null,
    is_active    boolean      not null default true,
    created_at   timestamptz  not null default now(),
    constraint ck_especialidades_codigo check (codigo ~ '^[a-z][a-z0-9_]*$'),
    constraint ck_especialidades_nome check (btrim(nome) <> '')
);

-- Evita nomes equivalentes com diferencas apenas de maiusculas/minusculas.
create unique index uq_especialidades_nome_lower on public.especialidades (lower(nome));

create table public.fornecedor_especialidades (
    id_usuario            uuid         not null references public.fornecedores (id_usuario) on delete cascade,
    codigo_especialidade  text         not null references public.especialidades (codigo) on delete restrict,
    created_at            timestamptz  not null default now(),
    constraint pk_fornecedor_especialidades primary key (id_usuario, codigo_especialidade)
);

create index ix_fornecedor_especialidades_codigo on public.fornecedor_especialidades (codigo_especialidade);

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
    ('serralheria', 'Serralheria');

commit;


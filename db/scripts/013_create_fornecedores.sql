begin;

create table public.fornecedores (
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

commit;


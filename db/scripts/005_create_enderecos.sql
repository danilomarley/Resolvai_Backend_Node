-- 005_create_enderecos.sql

create table if not exists public.enderecos (
    id            uuid         primary key default gen_random_uuid(),
    id_usuario    uuid         not null references public.users (id) on delete cascade,
    apelido       text,
    logradouro    text         not null,
    numero        text,
    complemento   text,
    bairro        text,
    cidade        text         not null,
    estado        text         not null,
    cep           text         not null,
    latitude      numeric,
    longitude     numeric,
    principal     boolean      not null default false
);

create index if not exists ix_enderecos_id_usuario on public.enderecos (id_usuario);

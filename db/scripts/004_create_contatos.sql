-- 004_create_contatos.sql

create extension if not exists pgcrypto;

create table if not exists public.contatos (
    id            uuid         primary key default gen_random_uuid(),
    id_usuario    uuid         not null references public.users (id) on delete cascade,
    tipo          text         not null,
    valor         text         not null,
    principal     boolean      not null default false,
    constraint ck_contatos_tipo check (tipo in ('telefone', 'whatsapp', 'email_alt'))
);

create index if not exists ix_contatos_id_usuario on public.contatos (id_usuario);

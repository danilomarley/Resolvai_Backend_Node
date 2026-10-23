-- 001_create_users.sql
-- Executar no SQL Editor do Supabase (PostgreSQL gerenciado).
-- O id de public.users deve ser o mesmo UUID de auth.users (Supabase Auth).

create extension if not exists citext;

create table if not exists public.users (
    id            uuid         primary key,
    name          text         not null,
    email         citext       not null,
    role          text         not null,
    is_active     boolean      not null default true,
    created_at    timestamptz  not null default now(),
    updated_at    timestamptz  null,
    constraint uq_users_email unique (email),
    constraint ck_users_role check (role in ('Viewer', 'Inspector', 'Admin'))
);

create index if not exists ix_users_is_active on public.users (is_active);

-- Bootstrap do primeiro administrador:
-- 1) Cadastre-se por POST /api/v1/auth/register (cria Viewer em Auth + perfil local)
-- 2) Promova a conta uma única vez:
-- update public.users set role = 'Admin', updated_at = now() where email = 'seu.email@example.com';

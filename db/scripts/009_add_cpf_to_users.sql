-- 009_add_cpf_to_users.sql

alter table public.users
    add column if not exists cpf text;

alter table public.users
    drop constraint if exists uq_users_cpf;

alter table public.users
    add constraint uq_users_cpf unique (cpf);

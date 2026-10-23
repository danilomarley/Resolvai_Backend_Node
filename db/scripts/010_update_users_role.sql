-- 010_update_users_role.sql
-- Ajusta public.users para os papéis reais do ResolvAI (Cliente/Prestador/Admin).

update public.users set role = 'Cliente' where role = 'Viewer';
update public.users set role = 'Prestador' where role = 'Inspector';

alter table public.users
    drop constraint if exists ck_users_role;

alter table public.users
    add constraint ck_users_role check (role in ('Cliente', 'Prestador', 'Admin'));

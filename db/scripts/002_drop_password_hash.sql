-- 002_drop_password_hash.sql
-- Se a tabela users já existia com password_hash (auth local), remova a coluna.
-- Credenciais passam a residir apenas no Supabase Auth (auth.users).

alter table if exists public.users
    drop column if exists password_hash;

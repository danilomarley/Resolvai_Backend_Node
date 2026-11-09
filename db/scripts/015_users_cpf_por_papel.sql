-- 015_users_cpf_por_papel.sql (referencia do esquema existente; nao reaplicar em producao)
-- Permite o mesmo CPF em contas de papeis diferentes, mantendo a unicidade por papel.
-- Validar primeiro em banco isolado. Producao exige autorizacao especifica.

begin;

alter table public.users
    add constraint uq_users_cpf_role unique (cpf, role);

alter table public.users
    drop constraint uq_users_cpf;

commit;


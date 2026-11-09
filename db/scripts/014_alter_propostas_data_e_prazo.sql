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

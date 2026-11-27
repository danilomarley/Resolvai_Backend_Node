-- 018_add_motivo_cancelamento_pedidos.sql
-- Cancelamento de pedido pelo contratante (Resolvai_Cliente#85): guarda o motivo, que é opcional.
-- Idempotente.

alter table public.pedidos add column if not exists motivo_cancelamento text;

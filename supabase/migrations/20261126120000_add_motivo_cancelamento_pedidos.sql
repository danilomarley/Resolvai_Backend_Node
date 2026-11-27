-- Cancelamento de pedido pelo contratante (Resolvai_Cliente#85): guarda o motivo, que é opcional.
alter table public.pedidos add column if not exists motivo_cancelamento text;

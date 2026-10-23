-- 011_create_ix_pedidos_cliente_criacao.sql
-- Executar após 006_create_pedidos.sql.
-- Atende à lista paginada de pedidos, aos pedidos recentes e aos contadores da Home:
-- filtra pelo cliente e segue a ordenação da listagem (data_criacao desc, id desc).

create index if not exists ix_pedidos_cliente_criacao
    on public.pedidos (id_cliente, data_criacao desc, id desc)
    include (status);

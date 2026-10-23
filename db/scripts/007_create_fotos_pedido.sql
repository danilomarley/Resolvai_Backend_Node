-- 007_create_fotos_pedido.sql

create table if not exists public.fotos_pedido (
    id            uuid         primary key default gen_random_uuid(),
    id_pedido     uuid         not null references public.pedidos (id) on delete cascade,
    foto          text         not null,
    descricao     text
);

create index if not exists ix_fotos_pedido_id_pedido on public.fotos_pedido (id_pedido);

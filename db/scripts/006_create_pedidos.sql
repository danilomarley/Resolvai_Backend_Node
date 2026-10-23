-- 006_create_pedidos.sql

create table if not exists public.pedidos (
    id                 uuid         primary key default gen_random_uuid(),
    id_cliente         uuid         not null references public.users (id),
    escopo             jsonb,
    status             text         not null default 'aberto',
    data_criacao       timestamptz  not null default now(),
    data_atualizacao   timestamptz,
    constraint ck_pedidos_status check (status in ('aberto', 'em_andamento', 'concluido', 'cancelado'))
);

create index if not exists ix_pedidos_id_cliente on public.pedidos (id_cliente);
create index if not exists ix_pedidos_status on public.pedidos (status);

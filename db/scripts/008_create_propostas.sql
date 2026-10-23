-- 008_create_propostas.sql

create table if not exists public.propostas (
    id             uuid          primary key default gen_random_uuid(),
    id_pedido      uuid          not null references public.pedidos (id) on delete cascade,
    id_prestador   uuid          not null references public.users (id),
    status         text          not null default 'enviada',
    valor          numeric(12,2) not null,
    prazo          text,
    descricao      text,
    garantia       text,
    constraint ck_propostas_status check (status in ('enviada', 'visualizada', 'escolhida'))
);

create index if not exists ix_propostas_id_pedido on public.propostas (id_pedido);
create index if not exists ix_propostas_id_prestador on public.propostas (id_prestador);

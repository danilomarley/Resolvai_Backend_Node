-- 020_create_pagamentos.sql
-- Pagamento do contrato por Pix (Resolvai_Cliente#97), cobrado pela AbacatePay.
-- Uma cobranca por tentativa: enquanto houver uma pendente ou paga para o contrato, nao nasce outra.
-- O valor fica em centavos, como a AbacatePay trabalha. Quando a cobranca e paga, o pedido passa a em_andamento.
-- Idempotente.

create table if not exists public.pagamentos (
    id               uuid         primary key default gen_random_uuid(),
    id_pedido        uuid         not null references public.pedidos (id),
    id_contrato      uuid         not null references public.contratos (id),
    id_cliente       uuid         not null references public.users (id),
    metodo           text         not null default 'pix',
    valor_centavos   integer      not null,
    status           text         not null default 'pendente',
    id_externo       text         not null,
    br_code          text         not null,
    qr_code_base64   text,
    ambiente_teste   boolean      not null default false,
    expira_em        timestamptz,
    pago_em          timestamptz,
    data_criacao     timestamptz  not null default now(),
    constraint ck_pagamentos_metodo check (metodo in ('pix')),
    constraint ck_pagamentos_status check (status in ('pendente', 'pago', 'expirado', 'cancelado')),
    constraint ck_pagamentos_valor check (valor_centavos >= 100),
    constraint ck_pagamentos_pago check ((status = 'pago') = (pago_em is not null)),
    constraint uq_pagamentos_id_externo unique (id_externo)
);

-- Uma cobranca viva (pendente ou paga) por contrato.
create unique index if not exists uq_pagamentos_contrato_ativo
    on public.pagamentos (id_contrato) where status in ('pendente', 'pago');

create index if not exists ix_pagamentos_id_pedido on public.pagamentos (id_pedido);
create index if not exists ix_pagamentos_id_cliente on public.pagamentos (id_cliente);

-- O acesso e feito pela API Node, com a conexao do servidor.
alter table public.pagamentos enable row level security;
revoke all privileges on table public.pagamentos from public, anon, authenticated;

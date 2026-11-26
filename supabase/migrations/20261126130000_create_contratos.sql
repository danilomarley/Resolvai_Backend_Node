-- Contrato de prestacao de servicos (Resolvai_Cliente#95), gerado quando o contratante aceita uma proposta.
-- O texto fica gravado como foi gerado (com o hash) para não mudar depois da assinatura. Cada parte assina
-- uma vez, com data e IP. Quando as duas assinam, o contrato passa para 'assinado' e libera o pagamento.
-- Idempotente.

create table if not exists public.contratos (
    id                       uuid          primary key default gen_random_uuid(),
    id_pedido                uuid          not null references public.pedidos (id),
    id_proposta              uuid          not null references public.propostas (id),
    id_cliente               uuid          not null references public.users (id),
    id_prestador             uuid          not null references public.users (id),
    versao_modelo            text          not null,
    texto                    text          not null,
    texto_hash               char(64)      not null,
    valor                    numeric(12,2) not null,
    status                   text          not null default 'pendente',
    assinado_cliente_em      timestamptz,
    assinatura_cliente_ip    text,
    assinado_prestador_em    timestamptz,
    assinatura_prestador_ip  text,
    data_criacao             timestamptz   not null default now(),
    constraint ck_contratos_status check (status in ('pendente', 'assinado')),
    constraint ck_contratos_assinado check (
        (status = 'assinado') = (assinado_cliente_em is not null and assinado_prestador_em is not null)
    ),
    constraint uq_contratos_pedido unique (id_pedido),
    constraint uq_contratos_proposta unique (id_proposta)
);

create index if not exists ix_contratos_id_cliente on public.contratos (id_cliente);
create index if not exists ix_contratos_id_prestador on public.contratos (id_prestador);

-- O acesso é feito pela API Node, com a conexão do servidor.
alter table public.contratos enable row level security;
revoke all privileges on table public.contratos from public, anon, authenticated;

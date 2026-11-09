-- 017_alter_propostas_status_e_unicidade.sql
-- Aceite de proposta (Resolvai_Cliente#84) e envio pelo prestador:
--   * novo status 'nao_escolhida' (as demais propostas do pedido quando uma é escolhida);
--   * no máximo UMA proposta por pedido e prestador;
--   * no máximo UMA proposta 'escolhida' por pedido.
-- Os índices são criados dentro de blocos que só avisam se já houver dados duplicados (corrija os dados e
-- rode de novo). Idempotente.

alter table public.propostas drop constraint if exists ck_propostas_status;
alter table public.propostas add constraint ck_propostas_status
    check (status in ('enviada', 'visualizada', 'escolhida', 'nao_escolhida'));

do $$
begin
    create unique index if not exists uq_propostas_pedido_prestador
        on public.propostas (id_pedido, id_prestador);
exception when unique_violation then
    raise notice 'uq_propostas_pedido_prestador não criado: já existem propostas duplicadas (mesmo pedido e prestador).';
end $$;

do $$
begin
    create unique index if not exists uq_propostas_escolhida_por_pedido
        on public.propostas (id_pedido) where status = 'escolhida';
exception when unique_violation then
    raise notice 'uq_propostas_escolhida_por_pedido não criado: há pedidos com mais de uma proposta escolhida.';
end $$;

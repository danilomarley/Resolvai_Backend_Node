import type { PropostaPrestadorResponse } from '../../application/dtos/prestador.js';
import type { StatusPedido, StatusProposta } from '../../domain/enums.js';
import { statusPropostaColumn } from './proposta-sql.js';

/** Compara sem acento e sem diferenciar maiúsculas (função criada pelo script 015). */
export const norm = (expressao: string) => `public.resolvai_norm(${expressao})`;

export const categoriaExpr = `nullif(btrim(p.escopo ->> 'categoria'), '')`;
export const tituloExpr = `coalesce(nullif(btrim(p.escopo ->> 'titulo'), ''), ${categoriaExpr}, 'Pedido')`;
export const localizacaoExpr = `nullif(btrim(p.escopo ->> 'localizacao'), '')`;

export const statusPedidoExpr = `
  case p.status
       when 'aberto' then 'Pending'
       when 'em_andamento' then 'InProgress'
       when 'concluido' then 'Completed'
       when 'cancelado' then 'Cancelled'
  end`;

/** Pedido aberto e ainda sem proposta escolhida: é o que o prestador pode disputar. */
export const abertoSemEscolhida = `(p.status = 'aberto' and not exists (
  select 1 from public.propostas e where e.id_pedido = p.id and e.status = 'escolhida'))`;

/**
 * Compatível = categoria do pedido está entre as do prestador E a cidade de alguma região dele aparece na
 * localização do pedido. `prestador` é o parâmetro SQL com o id do prestador (ex.: $1).
 */
export const compativelExpr = (prestador: string) => `(
  exists (select 1
            from public.prestador_categorias pc
            join public.categorias_servico c on c.id = pc.id_categoria
           where pc.id_prestador = ${prestador}
             and ${norm('c.nome')} = ${norm(`(p.escopo ->> 'categoria')`)})
  and exists (select 1
                from public.prestador_regioes r
               where r.id_prestador = ${prestador}
                 and strpos(${norm(`(p.escopo ->> 'localizacao')`)}, ${norm('r.cidade')}) > 0))`;

export const propostaPrestadorColumns = `
  pr.id as "id",
  pr.id_pedido as "orderId",
  ${tituloExpr} as "orderTitle",
  ${categoriaExpr} as "orderCategory",
  ${localizacaoExpr} as "orderLocation",
  ${statusPedidoExpr} as "orderStatus",
  ${statusPropostaColumn} as "status",
  pr.valor as "value",
  pr.prazo as "deadline",
  pr.prazo_dias as "deadlineDays",
  pr.descricao as "description",
  pr.garantia as "warranty",
  pr.data_criacao as "createdAt"`;

export const propostaPrestadorFrom = `
  from public.propostas pr
  join public.pedidos p on p.id = pr.id_pedido`;

export interface PropostaPrestadorRow {
  id: string;
  orderId: string;
  orderTitle: string;
  orderCategory: string | null;
  orderLocation: string | null;
  orderStatus: StatusPedido;
  status: StatusProposta;
  value: number;
  deadline: string | null;
  deadlineDays: number | null;
  description: string | null;
  warranty: string | null;
  createdAt: Date;
}

const opcional = <T>(valor: T | null): T | undefined => valor ?? undefined;

export function toPropostaPrestador(row: PropostaPrestadorRow): PropostaPrestadorResponse {
  return {
    id: row.id,
    orderId: row.orderId,
    orderTitle: row.orderTitle,
    orderCategory: opcional(row.orderCategory),
    orderLocation: opcional(row.orderLocation),
    orderStatus: row.orderStatus,
    status: row.status,
    value: row.value,
    deadline: opcional(row.deadline),
    deadlineDays: opcional(row.deadlineDays),
    description: opcional(row.description),
    warranty: opcional(row.warranty),
    createdAt: row.createdAt.toISOString()
  };
}

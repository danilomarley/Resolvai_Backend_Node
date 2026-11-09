import type { PropostaPrestadorResponse } from '../../application/dtos/prestador.js';
import type { StatusPedido, StatusProposta } from '../../domain/enums.js';
import { statusPropostaColumn } from './proposta-sql.js';

/** Built-ins only: category/city matching needs no extra database function or catalog. */
export const norm = (expressao: string) => `regexp_replace(translate(lower(btrim(coalesce(${expressao},''))), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'), '[[:space:]_-]+', ' ', 'g')`;

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
 * Compatível = categoria do pedido está nas especialidades do fornecedor E sua cidade principal aparece na
 * localização do pedido. `prestador` é o parâmetro SQL com o id do prestador (ex.: $1).
 */
export const compativelExpr = (prestador: string) => `(
  exists (select 1
            from public.fornecedor_especialidades fe
            join public.especialidades e on e.codigo=fe.codigo_especialidade and e.is_active
           where fe.id_usuario = ${prestador}
             and ${norm(`(p.escopo ->> 'categoria')`)} in (${norm('e.nome')}, ${norm('e.codigo')}))
  and exists (select 1
                from public.fornecedores f
               where f.id_usuario = ${prestador}
                 and nullif(btrim(f.cidade_atuacao),'') is not null
                 and strpos(${norm(`(p.escopo ->> 'localizacao')`)}, ${norm('f.cidade_atuacao')}) > 0))`;

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

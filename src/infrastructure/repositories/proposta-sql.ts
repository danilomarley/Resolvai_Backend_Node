import type { AvaliacaoDoPrestador, PropostaResponse } from '../../application/dtos/pedidos.js';
import type { StatusProposta } from '../../domain/enums.js';

// Os status do banco ficam em português; a API expõe os nomes de StatusProposta.
export const statusPropostaColumn = `
  case pr.status
       when 'enviada' then 'Sent'
       when 'visualizada' then 'Viewed'
       when 'escolhida' then 'Chosen'
       when 'nao_escolhida' then 'NotChosen'
  end`;

/**
 * Colunas de uma proposta com os dados do prestador. Usar junto com propostaFrom, que traz os apelidos
 * pr (propostas), p (pedidos), u (users do prestador) e rating (média das avaliações que ele recebeu).
 */
export const propostaColumns = `
  pr.id as "id",
  pr.id_prestador as "providerId",
  u.name as "providerName",
  ${statusPropostaColumn} as "status",
  pr.valor as "value",
  pr.prazo as "deadline",
  pr.prazo_dias as "deadlineDays",
  pr.descricao as "description",
  pr.garantia as "warranty",
  pr.data_criacao as "createdAt",
  rating.media as "ratingAverage",
  coalesce(rating.total, 0) as "ratingCount"`;

export const propostaFrom = `
  from public.propostas pr
  join public.pedidos p on p.id = pr.id_pedido
  join public.users u on u.id = pr.id_prestador
  left join lateral (
    select avg(a.nota) as media, count(*) as total
      from public.avaliacoes a
     where a.id_prestador = pr.id_prestador
  ) rating on true`;

export interface PropostaRow {
  id: string;
  providerId: string;
  providerName: string;
  status: StatusProposta;
  value: number;
  deadline: string | null;
  deadlineDays: number | null;
  description: string | null;
  warranty: string | null;
  createdAt: Date;
  ratingAverage: number | null;
  ratingCount: number;
}

// Campos nulos são omitidos do JSON, como o JsonIgnoreCondition.WhenWritingNull da API C#.
const opcional = <T>(valor: T | null): T | undefined => valor ?? undefined;

export function toAvaliacaoDoPrestador(row: Pick<PropostaRow, 'ratingAverage' | 'ratingCount'>): AvaliacaoDoPrestador {
  return {
    average: row.ratingAverage === null ? null : Math.round(row.ratingAverage * 10) / 10,
    count: row.ratingCount
  };
}

export function toProposta(row: PropostaRow): PropostaResponse {
  return {
    id: row.id,
    providerId: row.providerId,
    providerName: row.providerName,
    status: row.status,
    value: row.value,
    deadline: opcional(row.deadline),
    deadlineDays: opcional(row.deadlineDays),
    description: opcional(row.description),
    warranty: opcional(row.warranty),
    createdAt: row.createdAt.toISOString(),
    providerRating: toAvaliacaoDoPrestador(row)
  };
}

import type { IPropostaRepository } from '../../application/services/proposta-service.js';
import type { PropostaResponse } from '../../application/dtos/pedidos.js';
import type { DirecaoPropostas, OrdenacaoPropostas, PropostaDetalheResponse } from '../../application/dtos/propostas.js';
import type { Database } from '../database.js';
import { propostaColumns, propostaFrom, toProposta, type PropostaRow } from './proposta-sql.js';

// Fragmentos fixos por ordenação; a direção vem de um enum validado, nunca do texto da requisição.
// Prestadores sem avaliação ou propostas sem prazo numérico ficam por último nas duas direções.
const ordenacao: Record<OrdenacaoPropostas, (direcao: DirecaoPropostas) => string> = {
  price: direcao => `pr.valor ${direcao}, pr.id`,
  deadline: direcao => `pr.prazo_dias ${direcao} nulls last, pr.valor, pr.id`,
  rating: direcao => `rating.media ${direcao} nulls last, rating.total desc, pr.valor, pr.id`
};

type DetalheRow = PropostaRow & { memberSince: Date; completedServices: number };

/**
 * Lê public.propostas (com public.users e a média de public.avaliacoes). Só o cliente dono do pedido enxerga as
 * propostas; pedido de outro cliente é tratado como inexistente.
 */
export class PropostaRepository implements IPropostaRepository {
  constructor(private readonly database: Database) {}

  list(orderId: string, customerId: string, sort: OrdenacaoPropostas, direction: DirecaoPropostas): Promise<PropostaResponse[] | null> {
    return this.database.transaction(async sql => {
      const [pedido] = await sql.query('select 1 as "ok" from public.pedidos where id = $1 and id_cliente = $2;', [orderId, customerId]);
      if (!pedido) {
        return null;
      }

      const rows = await sql.query<PropostaRow>(
        `select ${propostaColumns}
          ${propostaFrom}
          where pr.id_pedido = $1
          order by ${ordenacao[sort](direction)};`,
        [orderId]
      );

      return rows.map(toProposta);
    }, 'repeatable read');
  }

  async getById(orderId: string, proposalId: string, customerId: string): Promise<PropostaDetalheResponse | null> {
    const [row] = await this.database.query<DetalheRow>(
      `select ${propostaColumns},
              u.created_at as "memberSince",
              (select count(*)
                 from public.propostas escolhida
                 join public.pedidos concluido on concluido.id = escolhida.id_pedido
                where escolhida.id_prestador = pr.id_prestador
                  and escolhida.status = 'escolhida'
                  and concluido.status = 'concluido') as "completedServices"
        ${propostaFrom}
        where pr.id = $1 and pr.id_pedido = $2 and p.id_cliente = $3;`,
      [proposalId, orderId, customerId]
    );

    if (!row) {
      return null;
    }

    return { ...toProposta(row), providerProfile: { memberSince: row.memberSince.toISOString(), completedServices: row.completedServices } };
  }

  async markViewed(orderId: string, proposalId: string, customerId: string): Promise<boolean> {
    const rows = await this.database.query(
      `update public.propostas pr
          set status = 'visualizada'
         from public.pedidos p
        where p.id = pr.id_pedido
          and pr.id = $1 and pr.id_pedido = $2 and p.id_cliente = $3
          and pr.status = 'enviada'
        returning pr.id;`,
      [proposalId, orderId, customerId]
    );

    return rows.length > 0;
  }
}

import type { IAvaliacaoRepository, ResultadoAvaliacao } from '../../application/services/avaliacao-service.js';
import type { Avaliacao, CriarAvaliacao, ResumoAvaliacoes } from '../../application/dtos/avaliacoes.js';
import type { Database } from '../database.js';

type Row = { orderId: string; providerId: string; rating: number; comment: string | null; createdAt: Date };
const columns = 'id_pedido as "orderId", id_prestador as "providerId", nota as rating, comentario as comment, data_criacao as "createdAt"';
const map = (row: Row): Avaliacao => ({ ...row, comment: row.comment ?? undefined, createdAt: row.createdAt.toISOString() });

export class AvaliacaoRepository implements IAvaliacaoRepository {
  constructor(private readonly database: Database) {}

  criar(orderId: string, customerId: string, input: CriarAvaliacao): Promise<ResultadoAvaliacao> {
    return this.database.transaction(async sql => {
      const [order] = await sql.query<{ status: string }>('select status from public.pedidos where id = $1 and id_cliente = $2 for update', [orderId, customerId]);
      if (!order) return 'notFound';
      if (order.status !== 'concluido') return 'notCompleted';
      const providers = await sql.query<{ id: string }>("select id_prestador as id from public.propostas where id_pedido = $1 and status = 'escolhida' for update", [orderId]);
      if (providers.length !== 1) return 'invalidProvider';
      const [row] = await sql.query<Row>(`insert into public.avaliacoes (id_pedido, id_cliente, id_prestador, nota, comentario)
        values ($1, $2, $3, $4, $5) on conflict (id_pedido) do nothing returning ${columns}`,
      [orderId, customerId, providers[0]!.id, input.rating, input.comment?.trim() || null]);
      return row ? map(row) : 'duplicate';
    });
  }

  async consultar(orderId: string, customerId: string): Promise<Avaliacao | null | undefined> {
    const [order] = await this.database.query('select id from public.pedidos where id = $1 and id_cliente = $2', [orderId, customerId]);
    if (!order) return undefined;
    const [row] = await this.database.query<Row>(`select ${columns} from public.avaliacoes where id_pedido = $1 and id_cliente = $2`, [orderId, customerId]);
    return row ? map(row) : null;
  }

  async resumo(customerId: string): Promise<ResumoAvaliacoes> {
    const [row] = await this.database.query<ResumoAvaliacoes>('select count(*) as count, avg(nota)::numeric as "averageRating" from public.avaliacoes where id_cliente = $1', [customerId]);
    return row!;
  }
}

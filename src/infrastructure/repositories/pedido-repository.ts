import { randomUUID } from 'node:crypto';
import type { IPedidoRepository, ResultadoAlteracaoPedido } from '../../application/contracts.js';
import type { NovaFotoPedidoRequest } from '../../application/dtos/pedidos.js';
import type { Database, Sql } from '../database.js';

export class PedidoRepository implements IPedidoRepository {
  constructor(private readonly database: Database) {}

  async add(id: string, idCliente: string, escopoJson: string, fotos: NovaFotoPedidoRequest[]): Promise<void> {
    await this.database.transaction(async sql => {
      await sql.query(
        `insert into public.pedidos (id, id_cliente, escopo, status)
         values ($1, $2, cast($3 as jsonb), 'aberto');`,
        [id, idCliente, escopoJson]
      );

      for (const foto of fotos) {
        await sql.query(
          `insert into public.fotos_pedido (id, id_pedido, foto, descricao)
           values ($1, $2, $3, $4);`,
          [randomUUID(), id, foto.url, foto.descricao ?? null]
        );
      }
    });
  }

  async update(id: string, idCliente: string, escopoJson: string, fotos: NovaFotoPedidoRequest[]): Promise<ResultadoAlteracaoPedido> {
    return this.database.transaction(async sql => {
      const bloqueio = await bloquearPedidoAberto(sql, id, idCliente);
      if (bloqueio) {
        return bloqueio;
      }

      await sql.query(
        'update public.pedidos set escopo = cast($2 as jsonb), data_atualizacao = now() where id = $1;',
        [id, escopoJson]
      );
      await sql.query('delete from public.fotos_pedido where id_pedido = $1;', [id]);

      for (const foto of fotos) {
        await sql.query(
          `insert into public.fotos_pedido (id, id_pedido, foto, descricao)
           values ($1, $2, $3, $4);`,
          [randomUUID(), id, foto.url, foto.descricao ?? null]
        );
      }

      return 'ok';
    });
  }

  async cancel(id: string, idCliente: string, motivo: string | null): Promise<ResultadoAlteracaoPedido> {
    return this.database.transaction(async sql => {
      const bloqueio = await bloquearPedidoAberto(sql, id, idCliente);
      if (bloqueio) {
        return bloqueio;
      }

      await sql.query(
        "update public.pedidos set status = 'cancelado', motivo_cancelamento = $2, data_atualizacao = now() where id = $1;",
        [id, motivo]
      );
      // Os prestadores veem as propostas pendentes como não escolhidas.
      await sql.query(
        "update public.propostas set status = 'nao_escolhida' where id_pedido = $1 and status in ('enviada', 'visualizada');",
        [id]
      );

      return 'ok';
    });
  }
}

/**
 * Trava o pedido do cliente e confere se ainda pode ser alterado. Devolve o motivo da recusa ou null quando pode.
 */
async function bloquearPedidoAberto(sql: Sql, id: string, idCliente: string): Promise<ResultadoAlteracaoPedido | null> {
  const [pedido] = await sql.query<{ status: string }>(
    'select status as "status" from public.pedidos where id = $1 and id_cliente = $2 for update;',
    [id, idCliente]
  );
  if (!pedido) {
    return 'notFound';
  }

  if (pedido.status !== 'aberto') {
    return 'closed';
  }

  const [escolhida] = await sql.query(
    "select 1 as \"ok\" from public.propostas where id_pedido = $1 and status = 'escolhida';",
    [id]
  );
  return escolhida ? 'proposalChosen' : null;
}

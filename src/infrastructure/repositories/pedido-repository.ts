import { randomUUID } from 'node:crypto';
import type { IPedidoRepository } from '../../application/contracts.js';
import type { NovaFotoPedidoRequest } from '../../application/dtos/pedidos.js';
import type { Database } from '../database.js';

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
}

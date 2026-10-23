import type { IContatoRepository } from '../../application/contracts.js';
import type { Contato } from '../../domain/contato.js';
import type { Sql } from '../database.js';

export class ContatoRepository implements IContatoRepository {
  constructor(private readonly sql: Sql) {}

  async add(contato: Contato): Promise<void> {
    await this.sql.query(
      `insert into contatos (id, id_usuario, tipo, valor, principal)
       values ($1, $2, $3, $4, $5);`,
      [contato.id, contato.idUsuario, contato.tipo, contato.valor, contato.principal]
    );
  }
}

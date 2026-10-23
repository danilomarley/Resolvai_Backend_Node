import type { IContatoRepository } from '../../application/contracts.js';
import { Contato } from '../../domain/contato.js';
import type { Sql } from '../database.js';

interface ContatoRow {
  id: string;
  idUsuario: string;
  tipo: string;
  valor: string;
  principal: boolean;
}

export class ContatoRepository implements IContatoRepository {
  constructor(private readonly sql: Sql) {}

  async add(contato: Contato): Promise<void> {
    await this.sql.query(
      `insert into contatos (id, id_usuario, tipo, valor, principal)
       values ($1, $2, $3, $4, $5);`,
      [contato.id, contato.idUsuario, contato.tipo, contato.valor, contato.principal]
    );
  }

  async getPrincipal(idUsuario: string): Promise<Contato | null> {
    const [row] = await this.sql.query<ContatoRow>(
      `select id, id_usuario as "idUsuario", tipo, valor, principal
         from contatos
        where id_usuario = $1
        order by principal desc, id
        limit 1;`,
      [idUsuario]
    );

    return row ? Contato.restore(row.id, row.idUsuario, row.tipo, row.valor, row.principal) : null;
  }

  async salvarPrincipal(contato: Contato): Promise<void> {
    const atualizados = await this.sql.query(
      `update contatos
          set tipo = $2, valor = $3
        where id = (select id from contatos where id_usuario = $1 order by principal desc, id limit 1)
        returning id;`,
      [contato.idUsuario, contato.tipo, contato.valor]
    );

    if (atualizados.length === 0) {
      await this.add(contato);
    }
  }
}

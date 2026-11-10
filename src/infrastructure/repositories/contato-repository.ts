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
    // Keep the professional phone when a shared account chooses an alternative
    // email as its customer contact. Publish one principal contact atomically.
    await this.sql.query(`with escolhido as (
      select id from public.contatos c where c.id_usuario=$1 and (
        not exists(select 1 from public.fornecedores f where f.id_usuario=$1)
        or c.tipo=$2 or (c.tipo in ('telefone','whatsapp') and $2 in ('telefone','whatsapp'))
      ) order by principal desc,id limit 1
    ), atualizado as (
      update public.contatos set tipo=$2,valor=$3,principal=true
       where id=(select id from escolhido) returning id
    ), inserido as (
      insert into public.contatos(id,id_usuario,tipo,valor,principal)
      select $4,$1,$2,$3,true where not exists(select 1 from atualizado) returning id
    ), salvo as (select id from atualizado union all select id from inserido)
    update public.contatos set principal=false
     where id_usuario=$1 and principal=true and id<>(select id from salvo)`,
    [contato.idUsuario, contato.tipo, contato.valor, contato.id]);
  }
}

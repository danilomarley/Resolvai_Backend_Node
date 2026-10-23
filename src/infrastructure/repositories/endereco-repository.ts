import type { IEnderecoRepository } from '../../application/contracts.js';
import { Endereco } from '../../domain/endereco.js';
import type { Sql } from '../database.js';

interface EnderecoRow {
  id: string;
  idUsuario: string;
  apelido: string | null;
  logradouro: string;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string;
  estado: string;
  cep: string;
  latitude: number | null;
  longitude: number | null;
  principal: boolean;
}

export class EnderecoRepository implements IEnderecoRepository {
  constructor(private readonly sql: Sql) {}

  async add(endereco: Endereco): Promise<void> {
    await this.sql.query(
      `insert into enderecos
           (id, id_usuario, apelido, logradouro, numero, complemento, bairro, cidade, estado, cep, latitude, longitude, principal)
       values
           ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13);`,
      toParameters(endereco)
    );
  }

  async getPrincipal(idUsuario: string): Promise<Endereco | null> {
    const [row] = await this.sql.query<EnderecoRow>(
      `select id, id_usuario as "idUsuario", apelido, logradouro, numero, complemento, bairro,
              cidade, estado, cep, latitude, longitude, principal
         from enderecos
        where id_usuario = $1
        order by principal desc, id
        limit 1;`,
      [idUsuario]
    );

    return row ? Endereco.restore(row.id, row.idUsuario, row) : null;
  }

  async salvarPrincipal(endereco: Endereco): Promise<void> {
    const atualizados = await this.sql.query(
      `update enderecos
          set apelido = $2, logradouro = $3, numero = $4, complemento = $5, bairro = $6,
              cidade = $7, estado = $8, cep = $9, latitude = $10, longitude = $11
        where id = (select id from enderecos where id_usuario = $1 order by principal desc, id limit 1)
        returning id;`,
      // Todos os parâmetros precisam aparecer no SQL; o PostgreSQL não infere o tipo de um parâmetro sem uso.
      toParameters(endereco).slice(1, 12)
    );

    if (atualizados.length === 0) {
      await this.add(endereco);
    }
  }
}

function toParameters(endereco: Endereco): unknown[] {
  return [
    endereco.id,
    endereco.idUsuario,
    endereco.apelido,
    endereco.logradouro,
    endereco.numero,
    endereco.complemento,
    endereco.bairro,
    endereco.cidade,
    endereco.estado,
    endereco.cep,
    endereco.latitude,
    endereco.longitude,
    endereco.principal
  ];
}

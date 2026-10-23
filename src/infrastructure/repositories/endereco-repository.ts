import type { IEnderecoRepository } from '../../application/contracts.js';
import type { Endereco } from '../../domain/endereco.js';
import type { Sql } from '../database.js';

export class EnderecoRepository implements IEnderecoRepository {
  constructor(private readonly sql: Sql) {}

  async add(endereco: Endereco): Promise<void> {
    await this.sql.query(
      `insert into enderecos
           (id, id_usuario, apelido, logradouro, numero, complemento, bairro, cidade, estado, cep, latitude, longitude, principal)
       values
           ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13);`,
      [
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
      ]
    );
  }
}

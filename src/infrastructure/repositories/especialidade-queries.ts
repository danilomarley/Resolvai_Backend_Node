import type { IEspecialidadeQueries } from '../../application/contracts.js';
import type { EspecialidadeResponse } from '../../application/dtos/fornecedores.js';
import type { Sql } from '../database.js';

export class EspecialidadeQueries implements IEspecialidadeQueries {
  constructor(private readonly sql: Sql) {}
  listActive(): Promise<EspecialidadeResponse[]> {
    return this.sql.query('select codigo, nome from especialidades where is_active = true order by nome, codigo');
  }
}

import type { IEspecialidadeQueries } from '../../application/contracts.js';
import type { EspecialidadeResponse } from '../../application/dtos/fornecedores.js';
import type { Sql } from '../database.js';

export class EspecialidadeQueries implements IEspecialidadeQueries {
  constructor(private readonly sql: Sql) {}
  listActive(): Promise<EspecialidadeResponse[]> {
    return this.sql.query(`select e.codigo, c.nome from public.especialidades e
      join public.categorias_servico c on replace(c.slug,'-','_')=e.codigo
      where e.is_active and c.ativo order by c.nome,e.codigo`);
  }
}

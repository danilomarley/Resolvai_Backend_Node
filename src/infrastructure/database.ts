import pg from 'pg';

/**
 * Executor de SQL usado pelos repositórios: o pool ou uma conexão dentro de transação.
 */
export interface Sql {
  query<T extends object = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
}

export type Isolamento = 'read committed' | 'repeatable read' | 'serializable';

export interface Database extends Sql {
  /** Executa o callback numa transação curta; commit no sucesso, rollback em qualquer erro. */
  transaction<T>(callback: (sql: Sql) => Promise<T>, isolamento?: Isolamento): Promise<T>;
  close(): Promise<void>;
}

export interface DatabaseOptions {
  connectionString: string;
  ssl: boolean;
  commandTimeoutSeconds: number;
  /** Tamanho máximo do pool (padrão 10). */
  maxConnections?: number;
}

const tipoInt8 = 20;
const tipoNumeric = 1700;

// count(*) volta como bigint e valores monetários como numeric; o pg entrega os dois como texto.
// A API C# devolvia números no JSON, então convertemos aqui (os valores cabem com folga em number).
const tipos = {
  getTypeParser(oid: number, format?: string) {
    if (oid === tipoInt8) {
      return (valor: string) => Number(valor);
    }

    if (oid === tipoNumeric) {
      return (valor: string) => Number(valor);
    }

    return pg.types.getTypeParser(oid, format as 'text');
  }
} as pg.CustomTypesConfig;

/**
 * Um único pool por aplicação (equivalente ao NpgsqlDataSource singleton da API C#).
 * Cada consulta pega uma conexão do pool e a devolve em seguida.
 */
export function createDatabase(options: DatabaseOptions): Database {
  const pool = new pg.Pool({
    connectionString: options.connectionString,
    // Mesmo comportamento do "SSL Mode=Require;Trust Server Certificate=true" da connection string C#.
    ssl: options.ssl ? { rejectUnauthorized: false } : false,
    query_timeout: options.commandTimeoutSeconds * 1000,
    types: tipos,
    max: options.maxConnections ?? 10
  });

  const executor = (client: pg.Pool | pg.PoolClient): Sql => ({
    async query<T extends object>(text: string, params?: unknown[]) {
      const result = await client.query<T>(text, params);
      return result.rows;
    }
  });

  return {
    ...executor(pool),

    async transaction<T>(callback: (sql: Sql) => Promise<T>, isolamento: Isolamento = 'read committed') {
      const client = await pool.connect();
      try {
        await client.query(`begin isolation level ${isolamento}`);
        const result = await callback(executor(client));
        await client.query('commit');
        return result;
      } catch (error) {
        await client.query('rollback').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },

    close: () => pool.end()
  };
}

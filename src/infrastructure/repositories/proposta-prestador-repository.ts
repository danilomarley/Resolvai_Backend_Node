import { randomUUID } from 'node:crypto';
import { criarPagina } from '../../application/dtos/common.js';
import type { CriarPropostaPrestador, EditarPropostaPrestador } from '../../application/dtos/prestador.js';
import type {
  FiltroPropostasPrestador,
  IPropostaPrestadorRepository,
  PaginaPropostasPrestador,
  ResultadoAlterarProposta,
  ResultadoCriarProposta,
  ResultadoRetirarProposta
} from '../../application/services/proposta-prestador-service.js';
import type { Database, Sql } from '../database.js';
import { contarPropostas } from './prestador-repository.js';
import { caminhosDoPortfolio } from './proposta-portfolio.js';
import { avaliarPedidoParaProposta } from './proposta-elegibilidade.js';
import {
  norm,
  propostaPrestadorColumns,
  propostaPrestadorFrom,
  tituloExpr,
  toPropostaPrestador,
  type PropostaPrestadorRow
} from './prestador-sql.js';

const statusDoBanco = { sent: 'enviada', viewed: 'visualizada', chosen: 'escolhida', notchosen: 'nao_escolhida' } as const;

const textoDoPrazo = (dias: number) => `${dias} ${dias === 1 ? 'dia' : 'dias'}`;
const violacaoDeUnicidade = (error: unknown) => (error as { code?: string }).code === '23505';

/**
 * Propostas enviadas pelo prestador. Só mexe nas dele; editar e retirar exigem proposta ainda não decidida
 * (enviada ou visualizada) em pedido aberto.
 */
export class PropostaPrestadorRepository implements IPropostaPrestadorRepository {
  constructor(private readonly database: Database) {}

  async create(orderId: string, prestadorId: string, input: CriarPropostaPrestador): Promise<ResultadoCriarProposta> {
    try {
      return await this.database.transaction(async sql => {
        const [pedido] = await sql.query<{ status: string; escolhida: boolean }>(
          `select p.status as "status",
                  exists (select 1 from public.propostas e where e.id_pedido = p.id and e.status = 'escolhida') as "escolhida"
             from public.pedidos p
            where p.id = $1
              for update of p;`,
          [orderId]
        );
        if (!pedido) {
          return 'notFound';
        }
        const eligibility = await avaliarPedidoParaProposta(sql, orderId, prestadorId, true);
        if (eligibility === 'incomplete') {
          return 'incomplete';
        }
        if (pedido.status !== 'aberto' || pedido.escolhida) {
          return 'closed';
        }
        if (eligibility !== 'available') {
          return 'notFound';
        }

        const [existente] = await sql.query('select 1 as "ok" from public.propostas where id_pedido = $1 and id_prestador = $2;', [orderId, prestadorId]);
        if (existente) {
          return 'duplicate';
        }

        const id = randomUUID();
        await sql.query(
          `insert into public.propostas (id, id_pedido, id_prestador, status, valor, prazo, prazo_dias, descricao, garantia)
           values ($1, $2, $3, 'enviada', $4, $5, $6, $7, $8);`,
          [id, orderId, prestadorId, input.value, textoDoPrazo(input.deadlineDays), input.deadlineDays, input.description.trim(), input.warranty.trim()]
        );
        return (await buscar(sql, id, prestadorId))!;
      });
    } catch (error) {
      if (violacaoDeUnicidade(error)) {
        return 'duplicate';
      }
      throw error;
    }
  }

  async list(prestadorId: string, filtro: FiltroPropostasPrestador, page: number, pageSize: number): Promise<PaginaPropostasPrestador> {
    const params: unknown[] = [prestadorId];
    const where = ['pr.id_prestador = $1'];
    if (filtro.status) {
      params.push(statusDoBanco[filtro.status]);
      where.push(`pr.status = $${params.length}`);
    }
    if (filtro.q) {
      params.push(filtro.q);
      where.push(`strpos(${norm(tituloExpr)}, ${norm(`$${params.length}`)}) > 0`);
    }
    const condicao = where.join(' and ');

    return this.database.transaction(async sql => {
      const [total] = await sql.query<{ total: number }>(
        `select count(*) as "total" ${propostaPrestadorFrom} where ${condicao};`,
        params
      );
      const rows = await sql.query<PropostaPrestadorRow>(
        `select ${propostaPrestadorColumns}
           ${propostaPrestadorFrom}
          where ${condicao}
          order by pr.data_criacao desc, pr.id desc
          limit $${params.length + 1} offset $${params.length + 2};`,
        [...params, pageSize, (page - 1) * pageSize]
      );
      return {
        ...criarPagina(rows.map(toPropostaPrestador), page, pageSize, total?.total ?? 0),
        counts: await contarPropostas(sql, prestadorId)
      };
    }, 'repeatable read');
  }

  getById(id: string, prestadorId: string) {
    return this.database.transaction(async sql => (await buscar(sql, id, prestadorId)) ?? null);
  }

  update(id: string, prestadorId: string, input: EditarPropostaPrestador): Promise<ResultadoAlterarProposta> {
    return this.database.transaction(async sql => {
      const estado = await travar(sql, id, prestadorId);
      if (estado !== 'editavel') {
        return estado;
      }

      const sets: string[] = [];
      const params: unknown[] = [id];
      const set = (coluna: string, valor: unknown) => {
        params.push(valor);
        sets.push(`${coluna} = $${params.length}`);
      };
      if (input.value !== undefined) set('valor', input.value);
      if (input.deadlineDays !== undefined) {
        set('prazo_dias', input.deadlineDays);
        set('prazo', textoDoPrazo(input.deadlineDays));
      }
      if (input.description !== undefined) set('descricao', input.description.trim());
      if (input.warranty !== undefined) {
        set('garantia', input.warranty.trim());
        // Free text from the legacy API replaces the structured warranty, not just its summary.
        set('garantia_prazo', null);
        set('garantia_tipo', null);
        set('garantia_condicoes', null);
      }
      // Retrying the original multipart request must not silently replay an edited proposal.
      set('payload_hash', null);

      await sql.query(`update public.propostas set ${sets.join(', ')} where id = $1;`, params);
      return (await buscar(sql, id, prestadorId))!;
    });
  }

  remove(id: string, prestadorId: string): Promise<ResultadoRetirarProposta> {
    return this.database.transaction(async sql => {
      const estado = await travar(sql, id, prestadorId);
      if (estado !== 'editavel') {
        return estado;
      }

      const [removed] = await sql.query<{ portfolio: unknown }>('delete from public.propostas where id = $1 returning portfolio;', [id]);
      return { caminhosPortfolio: caminhosDoPortfolio(removed?.portfolio, prestadorId, id) };
    });
  }
}

async function buscar(sql: Sql, id: string, prestadorId: string) {
  const [row] = await sql.query<PropostaPrestadorRow>(
    `select ${propostaPrestadorColumns}
       ${propostaPrestadorFrom}
      where pr.id = $1 and pr.id_prestador = $2;`,
    [id, prestadorId]
  );
  return row ? toPropostaPrestador(row) : undefined;
}

/** Trava proposta e pedido e diz se ainda dá para alterar a proposta. */
async function travar(sql: Sql, id: string, prestadorId: string): Promise<'notFound' | 'locked' | 'editavel'> {
  // Acceptance and submission lock the order first; use the same order here.
  const [pedido] = await sql.query(
    `select p.id from public.pedidos p join public.propostas pr on pr.id_pedido=p.id
      where pr.id=$1 and pr.id_prestador=$2 for update of p`, [id, prestadorId]
  );
  if (!pedido) return 'notFound';
  const [estado] = await sql.query<{ proposta: string; pedido: string }>(
    `select pr.status as "proposta", p.status as "pedido"
       from public.propostas pr
       join public.pedidos p on p.id = pr.id_pedido
      where pr.id = $1 and pr.id_prestador = $2
        for update of pr;`,
    [id, prestadorId]
  );
  if (!estado) {
    return 'notFound';
  }

  if (!['enviada', 'visualizada'].includes(estado.proposta) || estado.pedido !== 'aberto') return 'locked';
  const [chosen] = await sql.query('select 1 from public.propostas where id_pedido = (select id_pedido from public.propostas where id=$1) and status=\'escolhida\'', [id]);
  return chosen ? 'locked' : 'editavel';
}

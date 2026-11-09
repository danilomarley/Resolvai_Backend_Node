import type { CriarProposta, IPropostaFornecedorRepository, PropostaEnviada, PropostaRegistro } from '../../application/dtos/propostas-fornecedor.js';
import { ConflictException, NotFoundException } from '../../application/errors.js';
import type { Database, Sql } from '../database.js';
import { pedidoDisponivelParaProposta } from './proposta-elegibilidade.js';

type Row = { id: string; id_pedido: string; id_prestador: string; status: string; valor: number; prazo: string | null; data_inicio: string | null; descricao: string | null; materiais: string | null; garantia: string | null; garantia_prazo: string | null; garantia_tipo: string | null; garantia_condicoes: string | null; portfolio: PropostaEnviada['portfolio']; payload_hash: string | null; data_criacao: Date };
const statusDoBanco: Record<string, PropostaEnviada['status']> = { enviada: 'Sent', visualizada: 'Viewed', escolhida: 'Chosen', nao_escolhida: 'NotChosen' };
function record(row: Row): PropostaRegistro {
  return { providerId: row.id_prestador, payloadHash: row.payload_hash, proposal: {
    id: row.id, orderId: row.id_pedido, status: statusDoBanco[row.status]!,
    value: row.valor, deadline: row.prazo ?? undefined, startDate: row.data_inicio ?? undefined, description: row.descricao ?? undefined,
    materials: row.materiais ?? undefined, warranty: { period: row.garantia_prazo ?? undefined, type: row.garantia_tipo ?? undefined, conditions: row.garantia_condicoes ?? undefined, text: row.garantia ?? undefined },
    portfolio: row.portfolio, createdAt: row.data_criacao.toISOString()
  } };
}
async function find(sql: Sql, id: string) {
  const [row] = await sql.query<Row>('select pr.*, pr.data_inicio::text as data_inicio from public.propostas pr where id=$1', [id]);
  return row ? record(row) : null;
}
async function assertAvailable(sql: Sql, orderId: string, providerId: string, lock = false): Promise<void> {
  if (!await pedidoDisponivelParaProposta(sql, orderId, providerId, lock)) throw new NotFoundException('Oportunidade disponível', orderId);
}
export class PropostaFornecedorRepository implements IPropostaFornecedorRepository {
  constructor(private readonly database: Database) {}
  find(id: string) { return find(this.database, id); }
  async assertAvailable(orderId: string, providerId: string) {
    await assertAvailable(this.database, orderId, providerId);
    const [duplicate] = await this.database.query('select id from public.propostas where id_pedido=$1 and id_prestador=$2', [orderId, providerId]);
    if (duplicate) throw new ConflictException('Você já enviou uma proposta para este pedido. Edite a proposta existente.');
  }
  async create(orderId: string, providerId: string, data: CriarProposta, hash: string, portfolio: PropostaEnviada['portfolio']) {
    try {
      return await this.database.transaction(async sql => {
        // Serialize submissions and order state changes for this order.
        const orders = await sql.query('select id from public.pedidos where id=$1 for update', [orderId]);
        if (!orders.length) throw new NotFoundException('Pedido', orderId);
        const existing = await find(sql, data.requestId);
        if (existing) {
          if (existing.providerId !== providerId || existing.proposal.orderId !== orderId || existing.payloadHash !== hash) throw new ConflictException('Identificador de envio já utilizado para outra proposta.');
          return { proposal: existing.proposal, created: false };
        }
        const [duplicate] = await sql.query('select id from public.propostas where id_pedido=$1 and id_prestador=$2', [orderId, providerId]);
        if (duplicate) throw new ConflictException('Você já enviou uma proposta para este pedido. Edite a proposta existente.');
        await assertAvailable(sql, orderId, providerId, true);
        const warranty = [data.guaranteePeriod, data.guaranteeType, data.guaranteeConditions].filter(Boolean).join(' · ');
        await sql.query(`insert into public.propostas
          (id,id_pedido,id_prestador,status,valor,prazo,data_inicio,descricao,materiais,garantia,garantia_prazo,garantia_tipo,garantia_condicoes,portfolio,payload_hash,prazo_dias)
          values($1,$2,$3,'enviada',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15)`,
        [data.requestId,orderId,providerId,data.valueCents / 100,data.deadline,data.startDate ?? null,data.description,data.materials ?? null,warranty,data.guaranteePeriod,data.guaranteeType,data.guaranteeConditions ?? null,JSON.stringify(portfolio),hash,Number.parseInt(data.deadline, 10)]);
        return { proposal: (await find(sql, data.requestId))!.proposal, created: true };
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new ConflictException('Identificador já utilizado ou proposta já enviada para este pedido.');
      throw error;
    }
  }
}

import type { CriarProposta, IPropostaRepository, PropostaEnviada, PropostaRegistro } from '../../application/dtos/propostas.js';
import { ConflictException, NotFoundException } from '../../application/errors.js';
import type { Database, Sql } from '../database.js';

const normalize = (value: string) => `regexp_replace(translate(lower(btrim(${value})), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'), '[[:space:]_]+', ' ', 'g')`;
type Row = { id: string; id_pedido: string; id_prestador: string; status: string; valor: number; prazo: string; data_inicio: string | null; descricao: string; materiais: string | null; garantia_prazo: string; garantia_tipo: string; garantia_condicoes: string | null; portfolio: PropostaEnviada['portfolio']; payload_hash: string | null; data_criacao: Date };
function record(row: Row): PropostaRegistro {
  return { providerId: row.id_prestador, payloadHash: row.payload_hash, proposal: {
    id: row.id, orderId: row.id_pedido, status: row.status === 'escolhida' ? 'Chosen' : row.status === 'visualizada' ? 'Viewed' : 'Sent',
    value: row.valor, deadline: row.prazo, startDate: row.data_inicio ?? undefined, description: row.descricao,
    materials: row.materiais ?? undefined, warranty: { period: row.garantia_prazo, type: row.garantia_tipo, conditions: row.garantia_condicoes ?? undefined },
    portfolio: row.portfolio, createdAt: row.data_criacao.toISOString()
  } };
}
async function find(sql: Sql, id: string) {
  const [row] = await sql.query<Row>('select pr.*, pr.data_inicio::text as data_inicio from public.propostas pr where id=$1', [id]);
  return row ? record(row) : null;
}
async function assertAvailable(sql: Sql, orderId: string, providerId: string, lock = false): Promise<void> {
  const rows = await sql.query(`select fe.id_usuario
    from public.pedidos p
    join public.fornecedor_especialidades fe on fe.id_usuario=$2
    join public.especialidades e on e.codigo=fe.codigo_especialidade and e.is_active=true
    join public.fornecedores f on f.id_usuario=fe.id_usuario
    join public.users u on u.id=f.id_usuario and u.role='Prestador' and u.is_active=true
    where p.id=$1 and p.status='aberto' and p.id_cliente<>$2
      and jsonb_typeof(p.escopo->'categoria')='string'
      and ${normalize("p.escopo->>'categoria'")} in (${normalize('e.codigo')},${normalize('e.nome')})
      and not exists(select 1 from public.propostas chosen where chosen.id_pedido=p.id and chosen.status='escolhida')
    ${lock ? 'for share of fe,e,f,u' : ''}`, [orderId, providerId]);
  if (!rows.length) throw new NotFoundException('Oportunidade disponível', orderId);
}
export class PropostaRepository implements IPropostaRepository {
  constructor(private readonly database: Database) {}
  find(id: string) { return find(this.database, id); }
  assertAvailable(orderId: string, providerId: string) { return assertAvailable(this.database, orderId, providerId); }
  create(orderId: string, providerId: string, data: CriarProposta, hash: string, portfolio: PropostaEnviada['portfolio']) {
    return this.database.transaction(async sql => {
      // Serialize submissions and order state changes for this order.
      const orders = await sql.query('select id from public.pedidos where id=$1 for update', [orderId]);
      if (!orders.length) throw new NotFoundException('Pedido', orderId);
      const existing = await find(sql, data.requestId);
      if (existing) {
        if (existing.providerId !== providerId || existing.proposal.orderId !== orderId || existing.payloadHash !== hash) throw new ConflictException('Identificador de envio já utilizado para outra proposta.');
        return { proposal: existing.proposal, created: false };
      }
      await assertAvailable(sql, orderId, providerId, true);
      const warranty = [data.guaranteePeriod, data.guaranteeType, data.guaranteeConditions].filter(Boolean).join(' · ');
      await sql.query(`insert into public.propostas
        (id,id_pedido,id_prestador,status,valor,prazo,data_inicio,descricao,materiais,garantia,garantia_prazo,garantia_tipo,garantia_condicoes,portfolio,payload_hash)
        values($1,$2,$3,'enviada',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14)`,
      [data.requestId,orderId,providerId,data.valueCents / 100,data.deadline,data.startDate ?? null,data.description,data.materials ?? null,warranty,data.guaranteePeriod,data.guaranteeType,data.guaranteeConditions ?? null,JSON.stringify(portfolio),hash]);
      return { proposal: (await find(sql, data.requestId))!.proposal, created: true };
    });
  }
}

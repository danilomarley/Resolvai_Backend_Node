import type { IOportunidadeQueries } from '../../application/contracts.js';
import { criarPagina } from '../../application/dtos/common.js';
import type { EspecialidadeResponse } from '../../application/dtos/fornecedores.js';
import type { ListarOportunidadesQuery, OportunidadeDetalhe, OportunidadeResumo, OportunidadesResponse } from '../../application/dtos/oportunidades.js';
import type { FotoPedidoResponse } from '../../application/dtos/pedidos.js';
import type { Database } from '../database.js';
import { compativelExpr, norm as normalize } from './prestador-sql.js';

const matchingOrders = `with specialties as (
  select e.codigo, e.nome
    from public.fornecedor_especialidades fe
    join public.especialidades e on e.codigo = fe.codigo_especialidade and e.is_active = true
    join public.fornecedores f on f.id_usuario = fe.id_usuario
    join public.users u on u.id = f.id_usuario and u.role = 'Prestador' and u.is_active = true
   where fe.id_usuario = $1
), matching_orders as (
  select p.id, coalesce(nullif(btrim(p.escopo->>'titulo'), ''), specialty.nome) as title,
         specialty.nome as category, specialty.codigo as "specialtyCode",
         nullif(btrim(p.escopo->>'localizacao'), '') as location,
         nullif(btrim(p.escopo->>'urgencia'), '') as urgency,
         p.data_criacao as "createdAt", p.escopo,
         (select count(*) from public.propostas pr where pr.id_pedido = p.id) as "proposalsCount"
    from public.pedidos p
    join lateral (
      select s.codigo, s.nome from specialties s
       where ${normalize("p.escopo->>'categoria'")} in (${normalize('s.codigo')}, ${normalize('s.nome')})
       order by s.codigo limit 1
    ) specialty on true
   where p.status = 'aberto' and p.id_cliente <> $1
     and jsonb_typeof(p.escopo->'categoria') = 'string'
     and ${compativelExpr('$1')}
     and not exists (select 1 from public.propostas chosen where chosen.id_pedido = p.id and chosen.status = 'escolhida')
)`;

type OpportunityRow = Omit<OportunidadeResumo, 'createdAt' | 'location' | 'urgency'> & {
  createdAt: Date; location: string | null; urgency: string | null;
  description?: string; details?: string | null; specifications?: string | null;
};

function summary(row: OpportunityRow): OportunidadeResumo {
  return {
    id: row.id, title: row.title, category: row.category, specialtyCode: row.specialtyCode,
    location: row.location ?? undefined, urgency: row.urgency ?? undefined,
    createdAt: row.createdAt.toISOString(), proposalsCount: row.proposalsCount
  };
}

export class OportunidadeQueries implements IOportunidadeQueries {
  constructor(private readonly database: Database) {}

  list(providerId: string, query: ListarOportunidadesQuery): Promise<OportunidadesResponse> {
    // strpos implements literal search, including '%' and '_', without wildcard injection.
    const filter = `where ($2 = '' or o."specialtyCode" = $2)
      and ($3 = '' or strpos(${normalize("concat_ws(' ', o.title, o.category, o.location)")}, ${normalize('$3::text')}) > 0)`;
    const params = [providerId, query.category, query.search];
    const order = query.sort === 'proposals' ? 'o."proposalsCount" asc, o."createdAt" desc, o.id desc' : 'o."createdAt" desc, o.id desc';
    return this.database.transaction(async sql => {
      const [count] = await sql.query<{ total: number }>(`${matchingOrders} select count(*) as total from matching_orders o ${filter}`, params);
      const rows = await sql.query<OpportunityRow>(`${matchingOrders}
        select o.id, o.title, o.category, o."specialtyCode", o.location, o.urgency, o."createdAt", o."proposalsCount"
          from matching_orders o ${filter} order by ${order} limit $4 offset $5`,
      [...params, query.pageSize, (query.page - 1) * query.pageSize]);
      const specialties = await sql.query<EspecialidadeResponse>(`${matchingOrders} select codigo, nome from specialties order by nome`, [providerId]);
      return { ...criarPagina(rows.map(summary), query.page, query.pageSize, count?.total ?? 0), specialties };
    }, 'repeatable read');
  }

  getById(id: string, providerId: string): Promise<OportunidadeDetalhe | null> {
    return this.database.transaction(async sql => {
      const [row] = await sql.query<OpportunityRow>(`${matchingOrders}
        select o.*, coalesce(btrim(o.escopo->>'descricao'), '') as description,
               nullif(btrim(o.escopo->>'detalhes'), '') as details,
               nullif(btrim(o.escopo->>'especificacoes'), '') as specifications
          from matching_orders o where o.id = $2`, [providerId, id]);
      if (!row) return null;
      const [client] = await sql.query<Omit<OportunidadeDetalhe['client'], 'memberSince'> & { memberSince: Date }>(`
        select u.name, u.created_at as "memberSince",
               (select count(*) from public.pedidos history where history.id_cliente = u.id) as "ordersCount",
               (select count(*) from public.pedidos history where history.id_cliente = u.id and history.status = 'concluido') as "completedOrdersCount"
          from public.users u join public.pedidos p on p.id_cliente = u.id where p.id = $1`, [id]);
      if (!client) return null;
      const photos = await sql.query<FotoPedidoResponse>(`select id, foto as url, descricao as description
        from public.fotos_pedido where id_pedido = $1 order by id`, [id]);
      return {
        ...summary(row), description: row.description ?? '', details: row.details ?? undefined,
        specifications: row.specifications ?? undefined,
        photos: photos.map(photo => ({ ...photo, description: photo.description ?? undefined })),
        client: { ...client, memberSince: client.memberSince.toISOString() }
      };
    }, 'repeatable read');
  }
}

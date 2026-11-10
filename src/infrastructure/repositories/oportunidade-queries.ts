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

  async list(providerId: string, query: ListarOportunidadesQuery): Promise<OportunidadesResponse> {
    // One statement gives items, total and specialties the same PostgreSQL snapshot,
    // without three SELECTs plus BEGIN/COMMIT over the remote database connection.
    // strpos remains a literal search, including '%' and '_'.
    const filter = `where ($2 = '' or o."specialtyCode" = $2)
      and ($3 = '' or strpos(${normalize("concat_ws(' ', o.title, o.category, o.location)")}, ${normalize('$3::text')}) > 0)`;
    const order = query.sort === 'proposals' ? 'o."proposalsCount" asc, o."createdAt" desc, o.id desc' : 'o."createdAt" desc, o.id desc';
    type ListRow = Omit<OpportunityRow, 'id'> & {
      id: string | null; total: number; specialties: EspecialidadeResponse[];
    };
    const rows = await this.database.query<ListRow>(`${matchingOrders}, filtered_orders as materialized (
      select o.id, o.title, o.category, o."specialtyCode", o.location, o.urgency, o."createdAt", o."proposalsCount"
        from matching_orders o ${filter}
    ), page_orders as (
      select o.id, o.title, o.category, o."specialtyCode", o.location, o.urgency, o."createdAt", o."proposalsCount"
        from filtered_orders o order by ${order} limit $4 offset $5
    )
    select o.*, totals.total,
           (select coalesce(jsonb_agg(jsonb_build_object('codigo', codigo, 'nome', nome) order by nome), '[]'::jsonb)
              from specialties) as specialties
      from (select count(*) as total from filtered_orders) totals
      left join page_orders o on true
     order by ${order}`,
    [providerId, query.category, query.search, query.pageSize, (query.page - 1) * query.pageSize]);
    // LEFT JOIN keeps totals/catalog even when the requested page contains no items.
    const items = rows.filter((row): row is ListRow & { id: string } => row.id !== null).map(summary);
    return { ...criarPagina(items, query.page, query.pageSize, rows[0]?.total ?? 0), specialties: rows[0]?.specialties ?? [] };
  }

  async getById(id: string, providerId: string): Promise<OportunidadeDetalhe | null> {
    type DetailRow = OpportunityRow & {
      clientName: string; memberSince: Date; ordersCount: number; completedOrdersCount: number;
      photos: FotoPedidoResponse[];
    };
    const [row] = await this.database.query<DetailRow>(`${matchingOrders}
      select o.*, coalesce(btrim(o.escopo->>'descricao'), '') as description,
             nullif(btrim(o.escopo->>'detalhes'), '') as details,
             nullif(btrim(o.escopo->>'especificacoes'), '') as specifications,
             u.name as "clientName", u.created_at as "memberSince",
             (select count(*) from public.pedidos history where history.id_cliente=u.id) as "ordersCount",
             (select count(*) from public.pedidos history where history.id_cliente=u.id and history.status='concluido') as "completedOrdersCount",
             (select coalesce(jsonb_agg(jsonb_build_object('id', photo.id, 'url', photo.foto, 'description', photo.descricao) order by photo.id), '[]'::jsonb)
                from public.fotos_pedido photo where photo.id_pedido=o.id) as photos
        from matching_orders o
        join public.pedidos p on p.id=o.id
        join public.users u on u.id=p.id_cliente
       where o.id=$2`, [providerId, id]);
    if (!row) return null;
    return {
      ...summary(row), description: row.description ?? '', details: row.details ?? undefined,
      specifications: row.specifications ?? undefined,
      photos: row.photos.map(photo => ({ ...photo, description: photo.description ?? undefined })),
      client: { name: row.clientName, memberSince: row.memberSince.toISOString(),
        ordersCount: row.ordersCount, completedOrdersCount: row.completedOrdersCount }
    };
  }
}

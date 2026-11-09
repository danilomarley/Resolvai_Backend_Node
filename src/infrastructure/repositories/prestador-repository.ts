import { criarPagina, type PaginaResponse } from '../../application/dtos/common.js';
import type { FotoPedidoResponse } from '../../application/dtos/pedidos.js';
import type {
  CategoriaServico,
  PedidoFeedItem,
  PedidoPrestadorResponse,
  PerfilPrestador,
  ResumoPrestador
} from '../../application/dtos/prestador.js';
import type { FiltroFeed, IPrestadorRepository } from '../../application/services/prestador-service.js';
import type { StatusPedido } from '../../domain/enums.js';
import type { Database, Sql } from '../database.js';
import {
  abertoSemEscolhida,
  categoriaExpr,
  compativelExpr,
  localizacaoExpr,
  norm,
  propostaPrestadorColumns,
  propostaPrestadorFrom,
  statusPedidoExpr,
  tituloExpr,
  toPropostaPrestador,
  type PropostaPrestadorRow
} from './prestador-sql.js';

interface FeedRow {
  id: string;
  title: string;
  category: string | null;
  location: string | null;
  urgency: string | null;
  createdAt: Date;
  proposalsCount: number;
  coverPhotoUrl: string | null;
  customerFirstName: string;
  compatible: boolean;
  myProposalId: string | null;
}

interface PedidoRow extends Omit<FeedRow, 'coverPhotoUrl'> {
  description: string;
  details: string | null;
  specifications: string | null;
  status: StatusPedido;
  open: boolean;
}

const opcional = <T>(valor: T | null): T | undefined => valor ?? undefined;

// Colunas comuns ao feed e ao detalhe. $1 é sempre o id do prestador.
const colunasPedido = `
  p.id as "id",
  ${tituloExpr} as "title",
  ${categoriaExpr} as "category",
  ${localizacaoExpr} as "location",
  nullif(btrim(p.escopo ->> 'urgencia'), '') as "urgency",
  p.data_criacao as "createdAt",
  (select count(*) from public.propostas pr where pr.id_pedido = p.id) as "proposalsCount",
  split_part(btrim(cu.name), ' ', 1) as "customerFirstName",
  ${compativelExpr('$1')} as "compatible",
  (select pr.id from public.propostas pr where pr.id_pedido = p.id and pr.id_prestador = $1) as "myProposalId"`;

const fromPedido = `
  from public.pedidos p
  join public.users cu on cu.id = p.id_cliente`;

/**
 * Perfil profissional, feed e detalhe de pedidos para o prestador. O contratante só aparece pelo primeiro
 * nome; endereço, telefone e documento nunca saem daqui.
 */
export class PrestadorRepository implements IPrestadorRepository {
  constructor(private readonly database: Database) {}

  async listCategorias(): Promise<CategoriaServico[]> {
    return this.database.query<CategoriaServico>(
      `select c.id as "id", c.slug as "slug", c.nome as "name"
         from public.categorias_servico c
         join public.especialidades e on e.codigo=replace(c.slug,'-','_')
        where c.ativo and e.is_active
        order by c.ordem,c.nome;`
    );
  }

  async getPerfil(prestadorId: string): Promise<Pick<PerfilPrestador, 'categories' | 'cities'>> {
    return this.database.transaction(async sql => {
      const categories = await sql.query<CategoriaServico>(
        `select c.id as "id", c.slug as "slug", c.nome as "name"
           from public.prestador_categorias pc
           join public.categorias_servico c on c.id = pc.id_categoria
          where pc.id_prestador = $1
          order by c.ordem, c.nome;`,
        [prestadorId]
      );
      const cities = await sql.query<{ cidade: string }>(
        'select cidade from public.prestador_regioes where id_prestador = $1 order by cidade;',
        [prestadorId]
      );
      return { categories, cities: cities.map(row => row.cidade) };
    }, 'repeatable read');
  }

  savePerfil(prestadorId: string, categoryIds: string[], cities: string[]): Promise<'ok' | 'invalidCategory'> {
    return this.database.transaction(async sql => {
      // The same lock is taken by the full profile editor; proposal creation takes it FOR SHARE.
      await sql.query('select id from public.users where id=$1 for update', [prestadorId]);
      const [validas] = await sql.query<{ total: number }>(
        `select count(*) as "total" from public.categorias_servico c
          join public.especialidades e on e.codigo=replace(c.slug,'-','_')
          where c.ativo and e.is_active and c.id=any($1::uuid[])`,
        [categoryIds]
      );
      if (validas?.total !== categoryIds.length) {
        return 'invalidCategory';
      }

      await sql.query('delete from public.prestador_categorias where id_prestador = $1;', [prestadorId]);
      await sql.query(
        'insert into public.prestador_categorias (id_prestador, id_categoria) select $1, unnest($2::uuid[]);',
        [prestadorId, categoryIds]
      );
      await sql.query('delete from public.prestador_regioes where id_prestador = $1;', [prestadorId]);
      await sql.query(
        'insert into public.prestador_regioes (id_prestador, cidade) select $1, unnest($2::text[]) on conflict do nothing;',
        [prestadorId, cities]
      );
      // Keep the supplier API and the existing provider API on the same professional profile.
      await sql.query('delete from public.fornecedor_especialidades where id_usuario=$1', [prestadorId]);
      await sql.query(`insert into public.fornecedor_especialidades(id_usuario,codigo_especialidade)
        select $1,replace(c.slug,'-','_') from public.categorias_servico c
          join public.fornecedores f on f.id_usuario=$1 where c.id=any($2::uuid[])`, [prestadorId, categoryIds]);
      await sql.query('update public.fornecedores set cidade_atuacao=$2,updated_at=now() where id_usuario=$1', [prestadorId, cities[0]]);
      return 'ok';
    });
  }

  getResumo(prestadorId: string): Promise<ResumoPrestador> {
    return this.database.transaction(async sql => {
      const [pedidos] = await sql.query<{ newOrdersLast24h: number; compatibleOpenOrders: number }>(
        `select count(*) filter (where p.data_criacao >= now() - interval '24 hours') as "newOrdersLast24h",
                count(*) filter (where ${compativelExpr('$1')}) as "compatibleOpenOrders"
           from public.pedidos p
          where ${abertoSemEscolhida};`,
        [prestadorId]
      );
      return { ...(pedidos ?? { newOrdersLast24h: 0, compatibleOpenOrders: 0 }), proposals: await contarPropostas(sql, prestadorId) };
    }, 'repeatable read');
  }

  listFeed(prestadorId: string, filtro: FiltroFeed, page: number, pageSize: number): Promise<PaginaResponse<PedidoFeedItem>> {
    const params: unknown[] = [prestadorId];
    const param = (valor: unknown) => {
      params.push(valor);
      return `$${params.length}`;
    };

    // $1 (o prestador) precisa aparecer em todas as consultas que recebem params, mesmo sem filtro de compatibilidade.
    const where = ['$1::uuid is not null', abertoSemEscolhida];
    if (filtro.category) {
      where.push(
        `${norm(`(p.escopo ->> 'categoria')`)} = (select ${norm('c.nome')} from public.categorias_servico c where c.slug = ${param(filtro.category)})`
      );
    }
    if (filtro.city) {
      where.push(`strpos(${norm(`(p.escopo ->> 'localizacao')`)}, ${norm(param(filtro.city))}) > 0`);
    }
    if (filtro.urgency) {
      where.push(`p.escopo ->> 'urgencia' = ${param(filtro.urgency)}`);
    }
    if (filtro.q) {
      where.push(
        `strpos(${norm(`concat_ws(' ', p.escopo ->> 'titulo', p.escopo ->> 'categoria', p.escopo ->> 'descricao')`)}, ${norm(param(filtro.q))}) > 0`
      );
    }
    if (filtro.compatible) {
      where.push(compativelExpr('$1'));
    }

    const condicao = where.join(' and ');

    return this.database.transaction(async sql => {
      const [total] = await sql.query<{ total: number }>(
        `select count(*) as "total" ${fromPedido} where ${condicao};`,
        params
      );
      const limite = param(pageSize);
      const deslocamento = param((page - 1) * pageSize);
      const rows = await sql.query<FeedRow>(
        `select ${colunasPedido},
                (select f.foto from public.fotos_pedido f where f.id_pedido = p.id order by f.id limit 1) as "coverPhotoUrl"
           ${fromPedido}
          where ${condicao}
          order by "compatible" desc, p.data_criacao desc, p.id desc
          limit ${limite} offset ${deslocamento};`,
        params
      );
      return criarPagina(rows.map(toFeedItem), page, pageSize, total?.total ?? 0);
    }, 'repeatable read');
  }

  getPedido(prestadorId: string, orderId: string): Promise<PedidoPrestadorResponse | null> {
    return this.database.transaction(async sql => {
      // Visível enquanto aberto, ou depois, para quem já enviou proposta (para acompanhar o desfecho).
      const [pedido] = await sql.query<PedidoRow>(
        `select ${colunasPedido},
                coalesce(btrim(p.escopo ->> 'descricao'), '') as "description",
                nullif(btrim(p.escopo ->> 'detalhes'), '') as "details",
                nullif(btrim(p.escopo ->> 'especificacoes'), '') as "specifications",
                ${statusPedidoExpr} as "status",
                ${abertoSemEscolhida} as "open"
           ${fromPedido}
          where p.id = $2
            and (p.status = 'aberto'
                 or exists (select 1 from public.propostas x where x.id_pedido = p.id and x.id_prestador = $1));`,
        [prestadorId, orderId]
      );
      if (!pedido) {
        return null;
      }

      const photos = await sql.query<{ id: string; url: string; description: string | null }>(
        `select f.id as "id", f.foto as "url", f.descricao as "description"
           from public.fotos_pedido f
          where f.id_pedido = $1
          order by f.id;`,
        [orderId]
      );
      const [minha] = await sql.query<PropostaPrestadorRow>(
        `select ${propostaPrestadorColumns}
           ${propostaPrestadorFrom}
          where pr.id_pedido = $1 and pr.id_prestador = $2;`,
        [orderId, prestadorId]
      );

      const fotos: FotoPedidoResponse[] = photos.map(foto => ({ id: foto.id, url: foto.url, description: opcional(foto.description) }));
      return {
        ...toFeedBase(pedido),
        description: pedido.description,
        details: opcional(pedido.details),
        specifications: opcional(pedido.specifications),
        status: pedido.status,
        open: pedido.open,
        photos: fotos,
        myProposal: minha ? toPropostaPrestador(minha) : undefined
      };
    }, 'repeatable read');
  }
}

export async function contarPropostas(sql: Sql, prestadorId: string): Promise<ResumoPrestador['proposals']> {
  const [contagem] = await sql.query<ResumoPrestador['proposals']>(
    `select count(*) as "total",
            count(*) filter (where status = 'enviada') as "sent",
            count(*) filter (where status = 'visualizada') as "viewed",
            count(*) filter (where status = 'escolhida') as "chosen",
            count(*) filter (where status = 'nao_escolhida') as "notChosen"
       from public.propostas
      where id_prestador = $1;`,
    [prestadorId]
  );
  return contagem ?? { total: 0, sent: 0, viewed: 0, chosen: 0, notChosen: 0 };
}

function toFeedBase(row: Omit<FeedRow, 'coverPhotoUrl'>) {
  return {
    id: row.id,
    title: row.title,
    category: opcional(row.category),
    location: opcional(row.location),
    urgency: opcional(row.urgency),
    createdAt: row.createdAt.toISOString(),
    proposalsCount: row.proposalsCount,
    customerFirstName: row.customerFirstName,
    compatible: row.compatible,
    myProposalId: opcional(row.myProposalId)
  };
}

function toFeedItem(row: FeedRow): PedidoFeedItem {
  return { ...toFeedBase(row), coverPhotoUrl: opcional(row.coverPhotoUrl) };
}

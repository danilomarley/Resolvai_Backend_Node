import type { IPedidoQueries } from '../../application/contracts.js';
import { criarPagina, type PaginaResponse } from '../../application/dtos/common.js';
import type { ContagemPedidosResponse, ContagemPropostasResponse, ResumoHomeResponse } from '../../application/dtos/home.js';
import type {
  FotoPedidoResponse,
  PedidoResponse,
  PedidoResumoResponse,
  PropostaResponse
} from '../../application/dtos/pedidos.js';
import { StatusPedido, type StatusProposta } from '../../domain/enums.js';
import type { Database, Sql } from '../database.js';

// Os status do banco ficam em português; a API expõe os nomes de StatusPedido/StatusProposta.
// Manter alinhado com toDbStatus.
const statusPedidoColumn = `
  case p.status
       when 'aberto' then 'Pending'
       when 'em_andamento' then 'InProgress'
       when 'concluido' then 'Completed'
       when 'cancelado' then 'Cancelled'
  end`;

const statusPropostaColumn = `
  case pr.status
       when 'enviada' then 'Sent'
       when 'visualizada' then 'Viewed'
       when 'escolhida' then 'Chosen'
  end`;

const categoriaColumn = `nullif(btrim(p.escopo ->> 'categoria'), '')`;

const tituloColumn = `coalesce(nullif(btrim(p.escopo ->> 'titulo'), ''), ${categoriaColumn}, 'Pedido')`;

const resumoColumns = `
  select p.id as "id",
         ${tituloColumn} as "title",
         ${categoriaColumn} as "category",
         ${statusPedidoColumn} as "status",
         p.data_criacao as "createdAt",
         p.data_atualizacao as "updatedAt",
         (select count(*) from public.propostas pr where pr.id_pedido = p.id) as "proposalsCount",
         (select max(pr.valor) from public.propostas pr
           where pr.id_pedido = p.id and pr.status = 'escolhida') as "chosenProposalValue"
    from public.pedidos p`;

const ordenacaoRecentes = 'order by p.data_criacao desc, p.id desc';

interface PedidoResumoRow {
  id: string;
  title: string;
  category: string | null;
  status: StatusPedido;
  createdAt: Date;
  updatedAt: Date | null;
  proposalsCount: number;
  chosenProposalValue: number | null;
}

interface PedidoRow {
  id: string;
  title: string;
  category: string | null;
  description: string;
  location: string | null;
  status: StatusPedido;
  createdAt: Date;
  updatedAt: Date | null;
  scope: unknown;
}

interface FotoRow {
  id: string;
  url: string;
  description: string | null;
}

interface PropostaRow {
  id: string;
  providerId: string;
  providerName: string;
  status: StatusProposta;
  value: number;
  deadline: string | null;
  description: string | null;
  warranty: string | null;
}

/**
 * Lê public.pedidos, public.propostas e public.fotos_pedido. Título, categoria, descrição e
 * localização vêm do jsonb pedidos.escopo (chaves descritas em docs/PEDIDOS-E-HOME.md).
 */
export class PedidoQueries implements IPedidoQueries {
  constructor(private readonly database: Database) {}

  list(userId: string, status: StatusPedido | undefined, page: number, pageSize: number): Promise<PaginaResponse<PedidoResumoResponse>> {
    const filtro = status === undefined ? '' : ' and p.status = $2';
    const params: unknown[] = status === undefined ? [userId] : [userId, toDbStatus(status)];
    const limite = params.length + 1;

    return this.readSnapshot(async sql => {
      const [total] = await sql.query<{ total: number }>(
        `select count(*) as "total" from public.pedidos p where p.id_cliente = $1${filtro};`,
        params
      );

      const rows = await sql.query<PedidoResumoRow>(
        `${resumoColumns}
          where p.id_cliente = $1${filtro}
          ${ordenacaoRecentes}
          limit $${limite} offset $${limite + 1};`,
        [...params, pageSize, (page - 1) * pageSize]
      );

      return criarPagina(rows.map(toResumo), page, pageSize, total?.total ?? 0);
    });
  }

  getById(id: string, userId: string): Promise<PedidoResponse | null> {
    return this.readSnapshot(async sql => {
      const [pedido] = await sql.query<PedidoRow>(
        `select p.id as "id",
                ${tituloColumn} as "title",
                ${categoriaColumn} as "category",
                coalesce(btrim(p.escopo ->> 'descricao'), '') as "description",
                nullif(btrim(p.escopo ->> 'localizacao'), '') as "location",
                ${statusPedidoColumn} as "status",
                p.data_criacao as "createdAt",
                p.data_atualizacao as "updatedAt",
                p.escopo as "scope"
           from public.pedidos p
          where p.id = $1 and p.id_cliente = $2;`,
        [id, userId]
      );

      if (!pedido) {
        return null;
      }

      const fotos = await sql.query<FotoRow>(
        `select f.id as "id", f.foto as "url", f.descricao as "description"
           from public.fotos_pedido f
           join public.pedidos p on p.id = f.id_pedido
          where f.id_pedido = $1 and p.id_cliente = $2
          order by f.id;`,
        [id, userId]
      );

      const propostas = await sql.query<PropostaRow>(
        `select pr.id as "id",
                pr.id_prestador as "providerId",
                u.name as "providerName",
                ${statusPropostaColumn} as "status",
                pr.valor as "value",
                pr.prazo as "deadline",
                pr.descricao as "description",
                pr.garantia as "warranty"
           from public.propostas pr
           join public.pedidos p on p.id = pr.id_pedido
           join public.users u on u.id = pr.id_prestador
          where pr.id_pedido = $1 and p.id_cliente = $2
          order by pr.status = 'escolhida' desc, pr.valor, pr.id;`,
        [id, userId]
      );

      return toPedido(pedido, fotos.map(toFoto), propostas.map(toProposta));
    });
  }

  getSummary(userId: string): Promise<ResumoHomeResponse> {
    return this.readSnapshot(async sql => {
      const [pedidos] = await sql.query<ContagemPedidosResponse>(
        `select count(*) as "total",
                count(*) filter (where status = 'aberto') as "pending",
                count(*) filter (where status = 'em_andamento') as "inProgress",
                count(*) filter (where status = 'concluido') as "completed",
                count(*) filter (where status = 'cancelado') as "cancelled",
                count(*) filter (where status in ('aberto', 'em_andamento')) as "active",
                count(*) filter (where data_criacao >= now() - interval '7 days') as "createdLast7Days"
           from public.pedidos
          where id_cliente = $1;`,
        [userId]
      );

      const [propostas] = await sql.query<ContagemPropostasResponse>(
        `select count(*) as "total",
                count(*) filter (where p.status = 'aberto') as "awaitingDecision",
                count(*) filter (where p.status = 'aberto' and pr.status = 'enviada') as "unviewed"
           from public.propostas pr
           join public.pedidos p on p.id = pr.id_pedido
          where p.id_cliente = $1;`,
        [userId]
      );

      const recentes = await sql.query<PedidoResumoRow>(
        `${resumoColumns}
          where p.id_cliente = $1
          ${ordenacaoRecentes}
          limit 5;`,
        [userId]
      );

      return {
        orders: pedidos!,
        proposals: propostas!,
        recentOrders: recentes.map(toResumo)
      };
    });
  }

  /**
   * Executa as consultas numa transação curta de leitura: contadores, página e listas relacionadas
   * vêm do mesmo snapshot mesmo com alterações concorrentes.
   */
  private readSnapshot<T>(callback: (sql: Sql) => Promise<T>): Promise<T> {
    return this.database.transaction(callback, 'repeatable read');
  }
}

export function toDbStatus(status: StatusPedido): string {
  switch (status) {
    case StatusPedido.Pending:
      return 'aberto';
    case StatusPedido.InProgress:
      return 'em_andamento';
    case StatusPedido.Completed:
      return 'concluido';
    case StatusPedido.Cancelled:
      return 'cancelado';
    default:
      throw new RangeError(`Status de pedido desconhecido: ${String(status)}.`);
  }
}

// Campos nulos são omitidos do JSON, como o JsonIgnoreCondition.WhenWritingNull da API C#.
const opcional = <T>(valor: T | null): T | undefined => valor ?? undefined;

function toResumo(row: PedidoResumoRow): PedidoResumoResponse {
  return {
    id: row.id,
    title: row.title,
    category: opcional(row.category),
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt?.toISOString(),
    proposalsCount: row.proposalsCount,
    chosenProposalValue: opcional(row.chosenProposalValue)
  };
}

function toPedido(row: PedidoRow, photos: FotoPedidoResponse[], proposals: PropostaResponse[]): PedidoResponse {
  return {
    id: row.id,
    title: row.title,
    category: opcional(row.category),
    description: row.description,
    location: opcional(row.location),
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt?.toISOString(),
    scope: opcional(row.scope),
    photos,
    proposals
  };
}

function toFoto(row: FotoRow): FotoPedidoResponse {
  return { id: row.id, url: row.url, description: opcional(row.description) };
}

function toProposta(row: PropostaRow): PropostaResponse {
  return {
    id: row.id,
    providerId: row.providerId,
    providerName: row.providerName,
    status: row.status,
    value: row.value,
    deadline: opcional(row.deadline),
    description: opcional(row.description),
    warranty: opcional(row.warranty)
  };
}

import type { ContratoResponse } from '../../application/dtos/contratos.js';
import type { IContratoRepository, ParteAssinante, ResultadoAssinatura } from '../../application/services/contrato-service.js';
import { gerarTextoContrato, hashDoContrato, versaoModeloContrato } from '../../domain/contrato.js';
import type { Database, Sql } from '../database.js';
import { tituloColumn } from './pedido-queries.js';

interface ContratoRow {
  id: string;
  orderId: string;
  proposalId: string;
  status: 'Pending' | 'Signed';
  templateVersion: string;
  text: string;
  textHash: string;
  value: number;
  customerName: string;
  providerName: string;
  customerSignedAt: Date | null;
  providerSignedAt: Date | null;
  createdAt: Date;
}

const colunasContrato = `
  select c.id as "id",
         c.id_pedido as "orderId",
         c.id_proposta as "proposalId",
         case c.status when 'assinado' then 'Signed' else 'Pending' end as "status",
         c.versao_modelo as "templateVersion",
         c.texto as "text",
         c.texto_hash as "textHash",
         c.valor as "value",
         cu.name as "customerName",
         pu.name as "providerName",
         c.assinado_cliente_em as "customerSignedAt",
         c.assinado_prestador_em as "providerSignedAt",
         c.data_criacao as "createdAt"
    from public.contratos c
    join public.users cu on cu.id = c.id_cliente
    join public.users pu on pu.id = c.id_prestador`;

function toContrato(row: ContratoRow): ContratoResponse {
  return {
    id: row.id,
    orderId: row.orderId,
    proposalId: row.proposalId,
    status: row.status,
    templateVersion: row.templateVersion,
    text: row.text,
    textHash: row.textHash,
    value: row.value,
    customerName: row.customerName,
    providerName: row.providerName,
    customerSignedAt: row.customerSignedAt?.toISOString(),
    providerSignedAt: row.providerSignedAt?.toISOString(),
    createdAt: row.createdAt.toISOString()
  };
}

interface DadosDoAceite {
  customerId: string;
  proposalId: string;
  providerId: string;
  value: number;
  term: string | null;
  warranty: string | null;
  warrantyConditions: string | null;
  materials: string | null;
  startDate: string | null;
  proposalDescription: string | null;
  title: string;
  category: string | null;
  description: string | null;
  location: string | null;
  details: string | null;
  urgency: string | null;
  specifications: string | null;
  customerName: string;
  customerDocument: string | null;
  providerName: string;
  providerDocument: string | null;
}

/**
 * Gera o contrato do pedido a partir da proposta escolhida, dentro da transação de quem chamou.
 * Não faz nada quando o pedido não tem proposta escolhida ou já tem contrato (gerar duas vezes é seguro).
 */
export async function gerarContrato(sql: Sql, orderId: string): Promise<void> {
  const [dados] = await sql.query<DadosDoAceite>(
    `select p.id_cliente as "customerId",
            pr.id as "proposalId",
            pr.id_prestador as "providerId",
            pr.valor as "value",
            pr.prazo as "term",
            pr.garantia as "warranty",
            pr.garantia_condicoes as "warrantyConditions",
            pr.materiais as "materials",
            pr.data_inicio::text as "startDate",
            pr.descricao as "proposalDescription",
            ${tituloColumn} as "title",
            nullif(btrim(p.escopo ->> 'categoria'), '') as "category",
            nullif(btrim(p.escopo ->> 'descricao'), '') as "description",
            nullif(btrim(p.escopo ->> 'localizacao'), '') as "location",
            nullif(btrim(p.escopo ->> 'detalhes'), '') as "details",
            nullif(btrim(p.escopo ->> 'urgencia'), '') as "urgency",
            nullif(btrim(p.escopo ->> 'especificacoes'), '') as "specifications",
            cu.name as "customerName",
            cu.cpf as "customerDocument",
            pu.name as "providerName",
            coalesce(f.cnpj, pu.cpf) as "providerDocument"
       from public.pedidos p
       join public.propostas pr on pr.id_pedido = p.id and pr.status = 'escolhida'
       join public.users cu on cu.id = p.id_cliente
       join public.users pu on pu.id = pr.id_prestador
       left join public.fornecedores f on f.id_usuario = pr.id_prestador
      where p.id = $1;`,
    [orderId]
  );
  if (!dados) {
    return;
  }

  const texto = gerarTextoContrato({
    contratante: { nome: dados.customerName, documento: dados.customerDocument },
    prestador: { nome: dados.providerName, documento: dados.providerDocument },
    pedido: {
      titulo: dados.title,
      categoria: dados.category,
      descricao: dados.description ?? dados.title,
      localizacao: dados.location,
      detalhes: dados.details,
      urgencia: dados.urgency,
      especificacoes: dados.specifications
    },
    proposta: {
      valor: dados.value,
      prazo: dados.term,
      garantia: dados.warranty,
      garantiaCondicoes: dados.warrantyConditions,
      materiais: dados.materials,
      dataInicio: dados.startDate,
      descricao: dados.proposalDescription
    },
    geradoEm: new Date()
  });

  await sql.query(
    `insert into public.contratos (id_pedido, id_proposta, id_cliente, id_prestador, versao_modelo, texto, texto_hash, valor)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict do nothing;`,
    [orderId, dados.proposalId, dados.customerId, dados.providerId, versaoModeloContrato, texto, hashDoContrato(texto), dados.value]
  );
}

// Colunas de cada parte; fixas no código, nunca vindas da requisição.
const colunasDaParte: Record<ParteAssinante, { usuario: string; assinadoEm: string; ip: string; outraAssinadaEm: string }> = {
  customer: { usuario: 'id_cliente', assinadoEm: 'assinado_cliente_em', ip: 'assinatura_cliente_ip', outraAssinadaEm: 'assinado_prestador_em' },
  provider: { usuario: 'id_prestador', assinadoEm: 'assinado_prestador_em', ip: 'assinatura_prestador_ip', outraAssinadaEm: 'assinado_cliente_em' }
};

/**
 * Lê e grava public.contratos. O contrato nasce no aceite da proposta; se uma proposta foi aceita antes de
 * existir esta tabela, ele é gerado na primeira consulta.
 */
export class ContratoRepository implements IContratoRepository {
  constructor(private readonly database: Database) {}

  getForCustomer(orderId: string, customerId: string): Promise<ContratoResponse | null> {
    return this.database.transaction(async sql => {
      const [pedido] = await sql.query('select 1 as "ok" from public.pedidos where id = $1 and id_cliente = $2;', [orderId, customerId]);
      if (!pedido) {
        return null;
      }

      const buscar = () => sql.query<ContratoRow>(`${colunasContrato} where c.id_pedido = $1;`, [orderId]);
      let [row] = await buscar();
      if (!row) {
        await gerarContrato(sql, orderId);
        [row] = await buscar();
      }

      return row ? toContrato(row) : null;
    });
  }

  getForProvider(proposalId: string, providerId: string): Promise<ContratoResponse | null> {
    return this.database.transaction(async sql => {
      const [proposta] = await sql.query<{ orderId: string }>(
        "select id_pedido as \"orderId\" from public.propostas where id = $1 and id_prestador = $2 and status = 'escolhida';",
        [proposalId, providerId]
      );
      if (!proposta) {
        return null;
      }

      const buscar = () => sql.query<ContratoRow>(`${colunasContrato} where c.id_proposta = $1;`, [proposalId]);
      let [row] = await buscar();
      if (!row) {
        await gerarContrato(sql, proposta.orderId);
        [row] = await buscar();
      }

      return row ? toContrato(row) : null;
    });
  }

  sign(contractId: string, parte: ParteAssinante, userId: string, textHash: string, ip: string | null): Promise<ResultadoAssinatura> {
    const colunas = colunasDaParte[parte];

    return this.database.transaction(async sql => {
      const [contrato] = await sql.query<{ hash: string; assinadoEm: Date | null }>(
        `select texto_hash as "hash", ${colunas.assinadoEm} as "assinadoEm"
           from public.contratos
          where id = $1 and ${colunas.usuario} = $2
            for update;`,
        [contractId, userId]
      );
      if (!contrato) {
        return 'notFound';
      }

      if (contrato.assinadoEm) {
        return 'alreadySigned';
      }

      if (contrato.hash.toLowerCase() !== textHash.toLowerCase()) {
        return 'hashMismatch';
      }

      // Numa só instrução, para a restrição ck_contratos_assinado enxergar o status e as datas juntos.
      await sql.query(
        `update public.contratos
            set ${colunas.assinadoEm} = now(),
                ${colunas.ip} = $2,
                status = case when ${colunas.outraAssinadaEm} is not null then 'assinado' else status end
          where id = $1;`,
        [contractId, ip]
      );
      return 'ok';
    });
  }
}

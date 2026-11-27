import type {
  ContratoParaCobranca,
  IPagamentoRepository,
  NovoPagamento,
  PagamentoRow
} from '../../application/services/pagamento-service.js';
import type { Database } from '../database.js';

const colunasPagamento = `
  select pg.id as "id",
         pg.id_pedido as "orderId",
         pg.id_cliente as "customerId",
         pg.status as "status",
         pg.valor_centavos as "valueCents",
         pg.id_externo as "externalId",
         pg.br_code as "brCode",
         pg.qr_code_base64 as "qrCodeBase64",
         pg.ambiente_teste as "testMode",
         pg.expira_em as "expiresAt",
         pg.pago_em as "paidAt",
         pg.data_criacao as "createdAt"
    from public.pagamentos pg`;

/** Lê e grava public.pagamentos. A confirmação do pagamento e a mudança do pedido acontecem na mesma transação. */
export class PagamentoRepository implements IPagamentoRepository {
  constructor(private readonly database: Database) {}

  async getContratoParaCobranca(orderId: string, customerId: string): Promise<ContratoParaCobranca | null> {
    const [row] = await this.database.query<ContratoParaCobranca>(
      `select c.id_pedido as "orderId",
              c.id as "contractId",
              c.status as "contractStatus",
              c.valor as "value"
         from public.contratos c
         join public.pedidos p on p.id = c.id_pedido
        where c.id_pedido = $1 and p.id_cliente = $2;`,
      [orderId, customerId]
    );
    return row ?? null;
  }

  async getAtual(orderId: string, customerId: string): Promise<PagamentoRow | null> {
    // Paga primeiro, depois pendente, depois a mais recente (uma expirada nao esconde uma nova cobranca).
    const [row] = await this.database.query<PagamentoRow>(
      `${colunasPagamento}
        where pg.id_pedido = $1 and pg.id_cliente = $2
        order by case pg.status when 'pago' then 0 when 'pendente' then 1 else 2 end, pg.data_criacao desc
        limit 1;`,
      [orderId, customerId]
    );
    return row ?? null;
  }

  // Dois pedidos de Pix ao mesmo tempo: o indice de cobranca ativa deixa so um, e o outro cai no conflito.
  async inserir(pagamento: NovoPagamento): Promise<void> {
    await this.database.query(
      `insert into public.pagamentos
         (id, id_pedido, id_contrato, id_cliente, valor_centavos, id_externo, br_code, qr_code_base64, ambiente_teste, expira_em)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       on conflict do nothing;`,
      [
        pagamento.id,
        pagamento.orderId,
        pagamento.contractId,
        pagamento.customerId,
        pagamento.valueCents,
        pagamento.externalId,
        pagamento.brCode,
        pagamento.qrCodeBase64,
        pagamento.testMode,
        pagamento.expiresAt
      ]
    );
  }

  async encerrar(externalId: string, status: 'expirado' | 'cancelado'): Promise<void> {
    await this.database.query("update public.pagamentos set status = $2 where id_externo = $1 and status = 'pendente';", [externalId, status]);
  }

  confirmar(externalId: string): Promise<boolean> {
    return this.database.transaction(async sql => {
      const [pagamento] = await sql.query<{ id: string; orderId: string; contractId: string; status: string }>(
        `select id as "id", id_pedido as "orderId", id_contrato as "contractId", status as "status"
           from public.pagamentos
          where id_externo = $1
            for update;`,
        [externalId]
      );
      if (!pagamento) {
        return false;
      }

      if (pagamento.status === 'pago') {
        return true;
      }

      // Pix pago depois de expirar (ou apos uma nova cobranca): a nova cobranca pendente sai do caminho.
      await sql.query("update public.pagamentos set status = 'cancelado' where id_contrato = $1 and id <> $2 and status = 'pendente';", [
        pagamento.contractId,
        pagamento.id
      ]);
      await sql.query("update public.pagamentos set status = 'pago', pago_em = now() where id = $1;", [pagamento.id]);
      await sql.query("update public.pedidos set status = 'em_andamento' where id = $1 and status = 'aberto';", [pagamento.orderId]);
      return true;
    });
  }
}

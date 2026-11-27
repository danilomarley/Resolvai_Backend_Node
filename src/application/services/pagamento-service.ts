import { randomUUID } from 'node:crypto';
import type { CurrentUser } from '../contracts.js';
import type { PagamentoResponse } from '../dtos/pagamentos.js';
import { ConflictException, NotFoundException, ServicoIndisponivelException, UnauthorizedException } from '../errors.js';
import {
  assinaturaDoWebhookConfere,
  reaisParaCentavos,
  segredoDoWebhookConfere,
  statusDaAbacatePay,
  validadePixSegundos,
  valorMinimoCentavos,
  type StatusPagamento
} from '../../domain/pagamento.js';

const guidVazio = '00000000-0000-0000-0000-000000000000';

export interface NovaCobrancaPix {
  valorCentavos: number;
  descricao: string;
  idExterno: string;
  expiraEmSegundos: number;
  metadata: Record<string, string>;
}

export interface CobrancaPix {
  id: string;
  status: string;
  brCode: string;
  qrCodeBase64: string | null;
  expiraEm: Date | null;
}

export interface ConsultaCobranca {
  status: string;
}

/** Gateway de pagamento (AbacatePay). Implementado em infrastructure/pagamento. */
export interface IGatewayPagamento {
  /** true quando a chave é de teste (abc_dev_). */
  readonly ambienteTeste: boolean;
  criarPix(nova: NovaCobrancaPix): Promise<CobrancaPix>;
  consultar(id: string): Promise<ConsultaCobranca>;
  /** Só existe em modo teste. */
  simularPagamento(id: string): Promise<void>;
}

export interface ContratoParaCobranca {
  orderId: string;
  contractId: string;
  contractStatus: 'pendente' | 'assinado';
  value: number;
}

export interface PagamentoRow {
  id: string;
  orderId: string;
  customerId: string;
  status: StatusPagamento;
  valueCents: number;
  externalId: string;
  brCode: string;
  qrCodeBase64: string | null;
  testMode: boolean;
  expiresAt: Date | null;
  paidAt: Date | null;
  createdAt: Date;
}

export interface NovoPagamento {
  id: string;
  orderId: string;
  contractId: string;
  customerId: string;
  valueCents: number;
  externalId: string;
  brCode: string;
  qrCodeBase64: string | null;
  testMode: boolean;
  expiresAt: Date | null;
}

export interface IPagamentoRepository {
  /** null quando o pedido não é do cliente ou ainda não tem contrato. */
  getContratoParaCobranca(orderId: string, customerId: string): Promise<ContratoParaCobranca | null>;
  /** Cobrança mais relevante do pedido (paga, senão a pendente, senão a mais recente); null se não houver. */
  getAtual(orderId: string, customerId: string): Promise<PagamentoRow | null>;
  inserir(pagamento: NovoPagamento): Promise<void>;
  /** Encerra uma cobrança pendente (expirada ou cancelada). Não mexe em cobrança já paga. */
  encerrar(externalId: string, status: 'expirado' | 'cancelado'): Promise<void>;
  /** Marca como paga e leva o pedido a em_andamento. false quando a cobrança não existe; repetir é seguro. */
  confirmar(externalId: string): Promise<boolean>;
}

export interface EntradaWebhook {
  corpoBruto: string;
  secretHeader?: string;
  secretQuery?: string;
  assinatura?: string;
}

/**
 * Pagamento do contrato por Pix (#96). Só cobra depois que as duas partes assinaram. O pagamento é confirmado
 * pelo webhook da AbacatePay ou, sem ele (ambiente local, Render dormindo), consultando o status da cobrança.
 */
export class PagamentoService {
  constructor(
    private readonly repository: IPagamentoRepository,
    private readonly gateway: IGatewayPagamento | undefined,
    private readonly webhookSecret: string | undefined
  ) {}

  /** Gera o Pix do pedido, ou devolve o que ainda está válido (chamar duas vezes não cobra duas vezes). */
  async iniciar(currentUser: CurrentUser, orderId: string): Promise<PagamentoResponse> {
    const userId = getUserId(currentUser);
    const gateway = this.exigirGateway();
    const contrato = await this.repository.getContratoParaCobranca(orderId, userId);
    if (!contrato) {
      throw new NotFoundException('Pedido', orderId);
    }

    if (contrato.contractStatus !== 'assinado') {
      throw new ConflictException('O pagamento só começa depois que as duas partes assinarem o contrato.');
    }

    const atual = await this.sincronizar(await this.repository.getAtual(orderId, userId));
    if (atual?.status === 'pago') {
      throw new ConflictException('Este pedido já foi pago.');
    }

    if (atual?.status === 'pendente') {
      return toResponse(atual);
    }

    const valueCents = reaisParaCentavos(contrato.value);
    if (valueCents < valorMinimoCentavos) {
      throw new ConflictException('O valor do contrato é menor que o mínimo aceito para pagamento (R$ 1,00).');
    }

    const id = randomUUID();
    const cobranca = await gateway.criarPix({
      valorCentavos: valueCents,
      descricao: `ResolvAI pedido ${orderId.slice(0, 8).toUpperCase()}`,
      idExterno: id,
      expiraEmSegundos: validadePixSegundos,
      metadata: { pagamentoId: id, pedidoId: orderId }
    });
    await this.repository.inserir({
      id,
      orderId,
      contractId: contrato.contractId,
      customerId: userId,
      valueCents,
      externalId: cobranca.id,
      brCode: cobranca.brCode,
      qrCodeBase64: cobranca.qrCodeBase64,
      testMode: gateway.ambienteTeste,
      expiresAt: cobranca.expiraEm
    });

    return this.obter(currentUser, orderId);
  }

  /** Estado do pagamento do pedido. Se ainda está pendente, confere na AbacatePay antes de responder. */
  async obter(currentUser: CurrentUser, orderId: string): Promise<PagamentoResponse> {
    const atual = await this.sincronizar(await this.repository.getAtual(orderId, getUserId(currentUser)));
    if (!atual) {
      throw new NotFoundException('Pagamento do pedido', orderId);
    }

    return toResponse(atual);
  }

  /** Paga a cobrança de teste sem dinheiro. Só funciona com a chave de teste. */
  async simular(currentUser: CurrentUser, orderId: string): Promise<PagamentoResponse> {
    const gateway = this.exigirGateway();
    const atual = await this.repository.getAtual(orderId, getUserId(currentUser));
    if (!atual) {
      throw new NotFoundException('Pagamento do pedido', orderId);
    }

    if (!gateway.ambienteTeste || !atual.testMode) {
      throw new ConflictException('A simulação de pagamento só existe em modo de teste.');
    }

    if (atual.status !== 'pendente') {
      throw new ConflictException('Esta cobrança não está mais pendente.');
    }

    await gateway.simularPagamento(atual.externalId);
    return this.obter(currentUser, orderId);
  }

  /**
   * Webhook da AbacatePay. Recusa (401) sem o segredo certo ou com assinatura inválida; eventos que não
   * interessam e cobranças desconhecidas respondem ok para não gerar novas tentativas.
   */
  async processarWebhook(entrada: EntradaWebhook): Promise<void> {
    if (!this.webhookSecret) {
      throw new ServicoIndisponivelException('O webhook de pagamento não está configurado.');
    }

    const secret = entrada.secretHeader ?? entrada.secretQuery;
    if (!segredoDoWebhookConfere(secret, this.webhookSecret) || !assinaturaDoWebhookConfere(entrada.corpoBruto, entrada.assinatura)) {
      throw new UnauthorizedException('Webhook não autorizado.');
    }

    const evento = lerEvento(entrada.corpoBruto);
    if (!evento) {
      return;
    }

    const status = statusDaAbacatePay(evento.status);
    if (status === 'pago') {
      await this.repository.confirmar(evento.id);
    } else if (status === 'expirado' || status === 'cancelado') {
      await this.repository.encerrar(evento.id, status);
    }
  }

  private exigirGateway(): IGatewayPagamento {
    if (!this.gateway) {
      throw new ServicoIndisponivelException('O pagamento está indisponível: a AbacatePay não foi configurada.');
    }

    return this.gateway;
  }

  /** Atualiza uma cobrança pendente com o status real da AbacatePay. Falha da consulta não derruba a leitura. */
  private async sincronizar(pagamento: PagamentoRow | null): Promise<PagamentoRow | null> {
    if (!pagamento || pagamento.status !== 'pendente' || !this.gateway) {
      return pagamento;
    }

    try {
      const status = statusDaAbacatePay((await this.gateway.consultar(pagamento.externalId)).status);
      if (status === 'pago') {
        await this.repository.confirmar(pagamento.externalId);
      } else if (status === 'expirado' || status === 'cancelado') {
        await this.repository.encerrar(pagamento.externalId, status);
      } else {
        return pagamento;
      }
    } catch (erro) {
      if (erro instanceof ServicoIndisponivelException) {
        return pagamento;
      }

      throw erro;
    }

    return this.repository.getAtual(pagamento.orderId, pagamento.customerId);
  }
}

function lerEvento(corpo: string): { id: string; status: string } | null {
  try {
    const json = JSON.parse(corpo) as { event?: string; data?: { transparent?: { id?: string; status?: string } } };
    const transparent = json.data?.transparent;
    if (json.event !== 'transparent.completed' || !transparent?.id || !transparent.status) {
      return null;
    }

    return { id: transparent.id, status: transparent.status };
  } catch {
    return null;
  }
}

const statusDto: Record<StatusPagamento, PagamentoResponse['status']> = {
  pendente: 'Pending',
  pago: 'Paid',
  expirado: 'Expired',
  cancelado: 'Cancelled'
};

function toResponse(row: PagamentoRow): PagamentoResponse {
  return {
    id: row.id,
    orderId: row.orderId,
    method: 'Pix',
    status: statusDto[row.status],
    amount: row.valueCents / 100,
    brCode: row.brCode,
    qrCodeBase64: row.qrCodeBase64 ?? undefined,
    expiresAt: row.expiresAt?.toISOString(),
    paidAt: row.paidAt?.toISOString(),
    testMode: row.testMode,
    createdAt: row.createdAt.toISOString()
  };
}

function getUserId(currentUser: CurrentUser): string {
  if (currentUser.isAuthenticated && currentUser.id && currentUser.id !== guidVazio) {
    return currentUser.id;
  }

  throw new UnauthorizedException('Token sem identificação de usuário.');
}

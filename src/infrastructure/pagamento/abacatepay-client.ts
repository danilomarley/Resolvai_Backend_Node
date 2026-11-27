import type { CobrancaPix, ConsultaCobranca, IGatewayPagamento, NovaCobrancaPix } from '../../application/services/pagamento-service.js';
import { ServicoIndisponivelException } from '../../application/errors.js';

export interface AbacatePayOptions {
  apiKey: string;
  baseUrl: string;
  /** Tempo maximo de cada chamada, em milissegundos. */
  timeoutMs?: number;
}

interface Envelope<T> {
  data: T | null;
  success: boolean;
  error: string | { message?: string } | null;
}

interface PixQrCode {
  id: string;
  status: string;
  devMode?: boolean;
  brCode?: string;
  brCodeBase64?: string | null;
  expiresAt?: string | null;
}

/**
 * Cliente da AbacatePay v2 para Pix (transparents). A chave e enviada como Bearer; o ambiente de teste vem
 * do prefixo abc_dev_. Falha de rede ou resposta de erro vira 503, sem repassar o texto do provedor ao usuario.
 */
export class AbacatePayClient implements IGatewayPagamento {
  readonly ambienteTeste: boolean;

  constructor(
    private readonly options: AbacatePayOptions,
    private readonly http: typeof fetch = fetch
  ) {
    this.ambienteTeste = options.apiKey.startsWith('abc_dev_');
  }

  async criarPix(nova: NovaCobrancaPix): Promise<CobrancaPix> {
    const pix = await this.chamar<PixQrCode>('POST', '/transparents/create', {
      method: 'PIX',
      data: {
        amount: nova.valorCentavos,
        description: nova.descricao,
        expiresIn: nova.expiraEmSegundos,
        externalId: nova.idExterno,
        metadata: nova.metadata
      }
    });

    if (!pix.id || !pix.brCode) {
      throw new ServicoIndisponivelException('A AbacatePay não devolveu o código Pix.');
    }

    return { id: pix.id, status: pix.status, brCode: pix.brCode, qrCodeBase64: pix.brCodeBase64 ?? null, expiraEm: pix.expiresAt ? new Date(pix.expiresAt) : null };
  }

  async consultar(id: string): Promise<ConsultaCobranca> {
    const pix = await this.chamar<PixQrCode>('GET', `/transparents/check?id=${encodeURIComponent(id)}`);
    return { status: pix.status };
  }

  async simularPagamento(id: string): Promise<void> {
    await this.chamar('POST', `/transparents/simulate-payment?id=${encodeURIComponent(id)}`);
  }

  private async chamar<T>(metodo: 'GET' | 'POST', caminho: string, corpo?: unknown): Promise<T> {
    let resposta: Response;
    try {
      resposta = await this.http(`${this.options.baseUrl}${caminho}`, {
        method: metodo,
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          ...(corpo ? { 'Content-Type': 'application/json' } : {})
        },
        body: corpo ? JSON.stringify(corpo) : undefined,
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 15000)
      });
    } catch (erro) {
      throw new ServicoIndisponivelException('Não foi possível falar com a AbacatePay. Tente novamente em instantes.', { cause: erro });
    }

    const envelope = (await resposta.json().catch(() => null)) as Envelope<T> | null;
    if (!resposta.ok || !envelope?.success || !envelope.data) {
      const motivo = typeof envelope?.error === 'string' ? envelope.error : envelope?.error?.message;
      throw new ServicoIndisponivelException('A AbacatePay recusou a operação de pagamento.', {
        cause: new Error(`AbacatePay ${resposta.status} ${caminho.split('?')[0]}: ${motivo ?? 'sem detalhe'}`)
      });
    }

    return envelope.data;
  }
}

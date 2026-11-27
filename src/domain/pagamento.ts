import { createHmac, timingSafeEqual } from 'node:crypto';

/** Estados do pagamento no ResolvAI. */
export const statusPagamento = ['pendente', 'pago', 'expirado', 'cancelado'] as const;
export type StatusPagamento = (typeof statusPagamento)[number];

/** Menor valor que a AbacatePay aceita cobrar, em centavos. */
export const valorMinimoCentavos = 100;

/** Validade do Pix: 30 minutos (a AbacatePay exige pelo menos 300 segundos). */
export const validadePixSegundos = 1800;

/**
 * Chave publica da AbacatePay para conferir a assinatura dos webhooks. E a mesma para todas as contas
 * e esta na documentacao (pages/notificacoes/seguranca); nao e o segredo do nosso webhook.
 */
export const chavePublicaAbacatePay =
  't9dXRhHHo3yDEj5pVDYz0frf7q6bMKyMRmxxCPIPp3RCplBfXRxqlC6ZpiWmOqj4L63qEaeUOtrCI8P0VMUgo6iIga2ri9ogaHFs0WIIywSMg0q7RmBfybe1E5XJcfC4IW3alNqym0tXoAKkzvfEjZxV6bE0oG2zJrNNYmUCKZyV0KZ3JS8Votf9EAWWYdiDkMkpbMdPggfh1EqHlVkMiTady6jOR3hyzGEHrIz2Ret0xHKMbiqkr9HS1JhNHDX9';

/** Converte reais em centavos sem erro de ponto flutuante (R$ 19,90 vira 1990). */
export function reaisParaCentavos(valor: number): number {
  return Math.round(Number((valor * 100).toPrecision(12)));
}

/**
 * Traduz o status da AbacatePay. PAID (Pix) e APPROVED (cartao) quitam; EXPIRED e CANCELLED encerram a
 * cobranca; os demais (PENDING, disputa, reembolso...) nao mudam o que temos.
 */
export function statusDaAbacatePay(status: string): StatusPagamento | null {
  switch (status) {
    case 'PAID':
    case 'APPROVED':
      return 'pago';
    case 'EXPIRED':
      return 'expirado';
    case 'CANCELLED':
      return 'cancelado';
    default:
      return null;
  }
}

function iguais(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Confere o segredo que cadastramos no webhook (header X-Webhook-Secret ou ?webhookSecret=). */
export function segredoDoWebhookConfere(recebido: string | undefined, esperado: string): boolean {
  return !!recebido && iguais(recebido, esperado);
}

/** HMAC-SHA256 do corpo bruto, em base64, com a chave publica da AbacatePay. */
export function assinaturaDoWebhookConfere(corpoBruto: string | Buffer, assinatura: string | undefined): boolean {
  if (!assinatura) {
    return false;
  }

  const esperada = createHmac('sha256', chavePublicaAbacatePay).update(corpoBruto).digest('base64');
  return iguais(esperada, assinatura);
}

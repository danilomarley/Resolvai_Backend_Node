import { z } from 'zod';
import { dataIso } from './validacao.js';

export const statusPagamentoDto = ['Pending', 'Paid', 'Expired', 'Cancelled'] as const;

/**
 * Cobrança Pix do contrato (#96). O brCode é o "Pix copia e cola"; qrCodeBase64 é a imagem do QR Code
 * (data URI PNG). Em modo teste, testMode é true e a cobrança pode ser paga por POST .../payment/simulate.
 */
export const pagamentoResponseSchema = z.object({
  id: z.guid(),
  orderId: z.guid(),
  method: z.literal('Pix'),
  status: z.enum(statusPagamentoDto).describe('Pending até o pagamento; Paid quando confirmado (o pedido passa a InProgress).'),
  amount: z.number().describe('Valor em reais.'),
  brCode: z.string().describe('Código Pix copia e cola.'),
  qrCodeBase64: z.string().optional().describe('Imagem do QR Code como data URI PNG.'),
  expiresAt: dataIso.optional(),
  paidAt: dataIso.optional(),
  testMode: z.boolean().describe('true quando a cobrança foi gerada com a chave de teste da AbacatePay.'),
  createdAt: dataIso
});

export type PagamentoResponse = z.infer<typeof pagamentoResponseSchema>;

/** Resposta do webhook: a AbacatePay só olha o código HTTP. */
export const webhookResponseSchema = z.object({ ok: z.boolean() });

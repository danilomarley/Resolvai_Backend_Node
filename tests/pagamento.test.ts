import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  assinaturaDoWebhookConfere,
  chavePublicaAbacatePay,
  reaisParaCentavos,
  segredoDoWebhookConfere,
  statusDaAbacatePay
} from '../src/domain/pagamento.js';

describe('pagamento (dominio)', () => {
  it('converte reais em centavos sem erro de ponto flutuante', () => {
    expect(reaisParaCentavos(800)).toBe(80000);
    expect(reaisParaCentavos(19.9)).toBe(1990);
    expect(reaisParaCentavos(0.29)).toBe(29);
    expect(reaisParaCentavos(1.005)).toBe(101);
  });

  it('traduz os status da AbacatePay', () => {
    expect(statusDaAbacatePay('PAID')).toBe('pago');
    expect(statusDaAbacatePay('APPROVED')).toBe('pago');
    expect(statusDaAbacatePay('EXPIRED')).toBe('expirado');
    expect(statusDaAbacatePay('CANCELLED')).toBe('cancelado');
    expect(statusDaAbacatePay('PENDING')).toBeNull();
    expect(statusDaAbacatePay('REFUNDED')).toBeNull();
  });

  it('confere o segredo do webhook em tempo constante e recusa vazio ou diferente', () => {
    expect(segredoDoWebhookConfere('abc', 'abc')).toBe(true);
    expect(segredoDoWebhookConfere('abd', 'abc')).toBe(false);
    expect(segredoDoWebhookConfere('abcd', 'abc')).toBe(false);
    expect(segredoDoWebhookConfere(undefined, 'abc')).toBe(false);
    expect(segredoDoWebhookConfere('', 'abc')).toBe(false);
  });

  it('confere a assinatura HMAC-SHA256 do corpo bruto', () => {
    const corpo = '{"event":"transparent.completed"}';
    const valida = createHmac('sha256', chavePublicaAbacatePay).update(corpo).digest('base64');
    expect(assinaturaDoWebhookConfere(corpo, valida)).toBe(true);
    expect(assinaturaDoWebhookConfere(`${corpo} `, valida)).toBe(false);
    expect(assinaturaDoWebhookConfere(corpo, 'assinatura-errada')).toBe(false);
    expect(assinaturaDoWebhookConfere(corpo, undefined)).toBe(false);
  });
});

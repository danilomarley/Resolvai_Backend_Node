import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { pagamentoResponseSchema, webhookResponseSchema } from '../../application/dtos/pagamentos.js';
import { pedidoIdParamsSchema } from '../../application/dtos/pedidos.js';
import type { PagamentoService } from '../../application/services/pagamento-service.js';
import { guidDaRota, semCache } from './util.js';

/**
 * Pagamento do pedido por Pix (Resolvai_Cliente#97). O contratante gera o Pix depois que o contrato foi assinado
 * pelas duas partes e acompanha o status; quem não é dono do pedido recebe 404.
 */
export function pagamentosRoutes(service: PagamentoService) {
  return async (app: FastifyInstance) => {
    const rotas = app.withTypeProvider<ZodTypeProvider>();

    rotas.post('/api/v1/orders/:id/payment', {
      schema: {
        tags: ['Pagamentos'],
        summary: 'Gera o Pix de pagamento do pedido.',
        description:
          'Só com o contrato assinado pelas duas partes (409 antes disso). Se já existe um Pix válido, devolve o mesmo, sem cobrar duas vezes. ' +
          '409 se o pedido já foi pago; 503 se a AbacatePay não está configurada ou fora do ar.',
        params: pedidoIdParamsSchema,
        response: { 200: pagamentoResponseSchema }
      },
      handler: async (request, reply) => {
        const id = guidDaRota(request, reply);
        if (!id) return reply;
        semCache(reply);
        return service.iniciar(request.usuario, id);
      }
    });

    rotas.get('/api/v1/orders/:id/payment', {
      schema: {
        tags: ['Pagamentos'],
        summary: 'Estado do pagamento do pedido.',
        description:
          'Se o Pix ainda está pendente, a API confere o status na AbacatePay antes de responder; por isso funciona mesmo sem o webhook. ' +
          '404 quando não há cobrança ou o pedido não é do usuário.',
        params: pedidoIdParamsSchema,
        response: { 200: pagamentoResponseSchema }
      },
      handler: async (request, reply) => {
        const id = guidDaRota(request, reply);
        if (!id) return reply;
        semCache(reply);
        return service.obter(request.usuario, id);
      }
    });

    rotas.post('/api/v1/orders/:id/payment/simulate', {
      schema: {
        tags: ['Pagamentos'],
        summary: 'Simula o pagamento do Pix (somente modo de teste).',
        description: 'Usa o recurso de simulação da AbacatePay. 409 com chave de produção ou quando a cobrança não está pendente.',
        params: pedidoIdParamsSchema,
        response: { 200: pagamentoResponseSchema }
      },
      handler: async (request, reply) => {
        const id = guidDaRota(request, reply);
        if (!id) return reply;
        semCache(reply);
        return service.simular(request.usuario, id);
      }
    });
  };
}

/**
 * Webhook da AbacatePay (transparent.completed). Rota pública: a autenticação é o segredo do webhook mais a
 * assinatura HMAC do corpo bruto, por isso o JSON chega como texto, sem ser interpretado antes da conferência.
 */
export function pagamentosWebhookRoutes(service: PagamentoService) {
  return async (app: FastifyInstance) => {
    app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, corpo, feito) => feito(null, corpo));

    app.withTypeProvider<ZodTypeProvider>().post('/api/v1/webhooks/abacatepay', {
      schema: {
        tags: ['Pagamentos'],
        summary: 'Webhook da AbacatePay.',
        description:
          'Recebe transparent.completed. Exige o segredo (header X-Webhook-Secret ou ?webhookSecret=) e X-Webhook-Signature (HMAC-SHA256 do corpo). ' +
          '401 se não conferir; 200 nos demais casos, inclusive eventos ignorados.',
        hide: true,
        response: { 200: webhookResponseSchema }
      },
      handler: async (request, reply) => {
        semCache(reply);
        const consulta = request.query as { webhookSecret?: string };
        const cabecalho = (nome: string) => {
          const valor = request.headers[nome];
          return Array.isArray(valor) ? valor[0] : valor;
        };
        await service.processarWebhook({
          corpoBruto: typeof request.body === 'string' ? request.body : '',
          secretHeader: cabecalho('x-webhook-secret'),
          secretQuery: consulta.webhookSecret,
          assinatura: cabecalho('x-webhook-signature')
        });
        return { ok: true };
      }
    });
  };
}

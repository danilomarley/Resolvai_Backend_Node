import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { prestadorPublicoSchema } from '../../application/dtos/prestador-publico.js';
import { pedidoIdParamsSchema } from '../../application/dtos/pedidos.js';
import type { PrestadorPublicoService } from '../../application/services/prestador-publico-service.js';
import { guidDaRota, semCache } from './util.js';

export function prestadorPublicoRoutes(service: PrestadorPublicoService) {
  return async (app: FastifyInstance) => {
    app.withTypeProvider<ZodTypeProvider>().get('/api/v1/providers/:id/public-profile', {
      schema: { tags: ['Prestadores'], summary: 'Perfil público do prestador que enviou proposta ao cliente autenticado.',
        description: 'Somente campos públicos. 404 também para prestador sem proposta em pedido do cliente ou inativo. photoUrl é null até alinhamento #53; categories e region são null quando o cadastro profissional não está disponível. reviewsAvailable=false indica ausência da fonte #92.',
        params: pedidoIdParamsSchema, response: { 200: prestadorPublicoSchema } },
      handler: async (request, reply) => {
        const id = guidDaRota(request, reply);
        if (!id) return reply;
        semCache(reply);
        return service.consultar(request.usuario, id);
      }
    });
  };
}

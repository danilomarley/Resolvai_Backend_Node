import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { IEspecialidadeQueries } from '../../application/contracts.js';
import { atualizarFornecedorRequestSchema, especialidadeResponseSchema, fornecedorResponseSchema, registerFornecedorRequestSchema } from '../../application/dtos/fornecedores.js';
import type { FornecedorService } from '../../application/services/fornecedor-service.js';
import { LimitadorDeTentativas } from '../limitador.js';

export function fornecedoresPublicRoutes(service: FornecedorService, especialidades: IEspecialidadeQueries) {
  const cadastrosPorIp = new LimitadorDeTentativas(10, 15 * 60 * 1000);
  return async (app: FastifyInstance) => {
    const rotas = app.withTypeProvider<ZodTypeProvider>();
    rotas.get('/api/v1/especialidades', {
      schema: { tags: ['Especialidades'], summary: 'Lista especialidades ativas.', response: { 200: z.array(especialidadeResponseSchema) } },
      handler: () => especialidades.listActive()
    });
    rotas.post('/api/v1/auth/register-provider', {
      onRequest: async request => { cadastrosPorIp.registrar(request.ip, 'Muitas tentativas de cadastro. Aguarde 15 minutos e tente novamente.'); },
      schema: { tags: ['Auth'], summary: 'Cadastra Prestador PF/PJ com perfil e especialidades.', body: registerFornecedorRequestSchema, response: { 201: fornecedorResponseSchema } },
      handler: async (request, reply) => reply.code(201).header('Cache-Control', 'no-store').header('Location', '/api/v1/fornecedores/me').send(await service.register(request.body))
    });
  };
}

export function fornecedoresRoutes(service: FornecedorService) {
  return async (app: FastifyInstance) => {
    app.addHook('preHandler', async (_request, reply) => { reply.header('Cache-Control', 'no-store'); });
    const rotas = app.withTypeProvider<ZodTypeProvider>();
    rotas.get('/api/v1/fornecedores/me', {
      schema: { tags: ['Fornecedores'], summary: 'Consulta o próprio perfil profissional.', response: { 200: fornecedorResponseSchema } },
      handler: request => service.getCurrent(request.usuario)
    });
    rotas.patch('/api/v1/fornecedores/me', {
      schema: { tags: ['Fornecedores'], summary: 'Atualiza os dados editáveis do próprio perfil profissional.', body: atualizarFornecedorRequestSchema, response: { 200: fornecedorResponseSchema } },
      handler: request => service.updateCurrent(request.usuario, request.body)
    });
  };
}

import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { criarPropostaSchema, propostaEnviadaSchema, type ArquivoPortfolio } from '../../application/dtos/propostas-fornecedor.js';
import type { PropostaFornecedorService } from '../../application/services/proposta-fornecedor-service.js';
import { DomainException } from '../../domain/errors.js';
import { ForbiddenException, NotFoundException } from '../../application/errors.js';
import { normalizarGuid } from '../guid.js';
import { LimitadorDeTentativas } from '../limitador.js';

export function propostasFornecedorRoutes(service: PropostaFornecedorService) {
  const limit = new LimitadorDeTentativas(20, 15 * 60 * 1000);
  return async (app: FastifyInstance) => {
    app.withTypeProvider<ZodTypeProvider>().get('/api/v1/fornecedores/me/oportunidades/:id/propostas/:proposalId', {
      schema: { tags: ['Propostas'], params: z.object({ id: z.string(), proposalId: z.string() }), response: { 200: propostaEnviadaSchema } },
      handler: async (request, reply) => {
        const orderId = normalizarGuid(request.params.id);
        const proposalId = normalizarGuid(request.params.proposalId);
        if (!orderId || !proposalId) throw new NotFoundException('Proposta', request.params.proposalId);
        return reply.header('Cache-Control', 'no-store').send(await service.get(request.usuario, orderId, proposalId));
      }
    });
    app.withTypeProvider<ZodTypeProvider>().post('/api/v1/fornecedores/me/oportunidades/:id/propostas', {
      schema: { tags: ['Propostas'], summary: 'Envia uma proposta e até cinco fotos do portfólio.', consumes: ['multipart/form-data'], params: z.object({ id: z.string() }), response: { 201: propostaEnviadaSchema } },
      handler: async (request, reply) => {
        if (request.usuario.role !== 'Prestador') throw new ForbiddenException();
        limit.registrar(request.usuario.id!);
        const id = normalizarGuid(request.params.id);
        if (!id) throw new NotFoundException('Pedido', request.params.id);
        if (!request.isMultipart()) throw new DomainException('Envie os dados e as fotos como multipart/form-data.');
        let payload: unknown;
        let receivedData = false;
        const files: ArquivoPortfolio[] = [];
        for await (const part of request.parts({ limits: { fileSize: 5 * 1024 * 1024, files: 5, fields: 1, fieldSize: 16384, parts: 6 } })) {
          if (part.type === 'file') {
            if (part.fieldname !== 'portfolio') { part.file.resume(); throw new DomainException('Campo de foto inválido.'); }
            const content = await part.toBuffer();
            files.push({ conteudo: content, contentType: part.mimetype.toLowerCase(), name: (part.filename.replace(/\\/g, '/').split('/').at(-1) || 'foto').slice(0, 200) });
          } else {
            if (part.fieldname !== 'proposal' || receivedData || part.valueTruncated || typeof part.value !== 'string') throw new DomainException('Dados de proposta inválidos.');
            receivedData = true;
            try { payload = JSON.parse(part.value); } catch { throw new DomainException('Dados de proposta inválidos.'); }
          }
        }
        const parsed = criarPropostaSchema.safeParse(payload);
        if (!parsed.success) throw new DomainException('Confira valor, prazo, descrição, data e garantia da proposta.');
        const result = await service.create(request.usuario, id, parsed.data, files);
        return reply.code(201).header('Cache-Control', 'no-store').header('Location', `/api/v1/fornecedores/me/oportunidades/${id}/propostas/${result.id}`).send(result);
      }
    });
  };
}

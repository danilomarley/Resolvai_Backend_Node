import { z } from 'zod';
import { dataIso } from './validacao.js';
import { inteiroDaQuery, propostaResponseSchema } from './pedidos.js';

export const ordenacoesPropostas = ['price', 'deadline', 'rating'] as const;
export const direcoesPropostas = ['asc', 'desc'] as const;

export type OrdenacaoPropostas = (typeof ordenacoesPropostas)[number];
export type DirecaoPropostas = (typeof direcoesPropostas)[number];

// Aceita o valor sem diferenciar maiúsculas, como o filtro de status de GET /api/v1/orders.
export const valorDaQuery = <T extends string>(campo: string, validos: readonly T[]) =>
  z
    .string()
    .optional()
    .transform((valor, ctx): T | undefined => {
      if (valor === undefined || valor === '') {
        return undefined;
      }

      const encontrado = validos.find(item => item === valor.trim().toLowerCase());
      if (!encontrado) {
        ctx.addIssue({ code: 'custom', message: `O valor '${valor}' não é válido para ${campo}.` });
        return z.NEVER;
      }

      return encontrado;
    });

/**
 * Query de GET /api/v1/orders/{id}/proposals. Os padrões dependem da ordenação e são resolvidos no serviço:
 * price e deadline crescem (menor primeiro); rating decresce (melhor primeiro).
 */
export const listarPropostasQuerySchema = z.object({
  sort: valorDaQuery('sort', ordenacoesPropostas).describe('price (padrão), deadline ou rating.'),
  direction: valorDaQuery('direction', direcoesPropostas).describe(
    'asc ou desc. Padrão: asc para price e deadline; desc para rating.'
  )
});

export type ListarPropostasQuery = z.output<typeof listarPropostasQuerySchema>;

export const listaPropostasResponseSchema = z.array(propostaResponseSchema);

/**
 * Resumo do prestador mostrado no detalhe da proposta.
 */
export const perfilDoPrestadorSchema = z.object({
  memberSince: dataIso,
  completedServices: z.number().int().nonnegative().describe('Serviços concluídos em que ele foi o prestador escolhido.')
});

export const propostaDetalheResponseSchema = propostaResponseSchema.extend({
  providerProfile: perfilDoPrestadorSchema
});

export type PropostaDetalheResponse = z.infer<typeof propostaDetalheResponseSchema>;

/**
 * Query de GET /api/v1/proposals/unviewed (#90): quantas propostas novas listar na navbar.
 */
export const propostasNovasQuerySchema = z.object({
  limit: inteiroDaQuery('limit', 1, 20, 10).describe('Itens da lista, entre 1 e 20 (padrão 10). O total não depende do limite.')
});

export type PropostasNovasQuery = z.output<typeof propostasNovasQuerySchema>;

export const propostaNovaResponseSchema = z.object({
  id: z.guid().describe('Id da proposta.'),
  orderId: z.guid(),
  orderTitle: z.string(),
  providerName: z.string(),
  value: z.number(),
  createdAt: dataIso.describe('Quando a proposta foi enviada.')
});

export type PropostaNovaResponse = z.infer<typeof propostaNovaResponseSchema>;

export const propostasNovasResponseSchema = z.object({
  total: z.number().int().nonnegative().describe('Propostas ainda não visualizadas, em pedidos abertos.'),
  items: z.array(propostaNovaResponseSchema).describe('As mais recentes primeiro, até o limite pedido.')
});

export type PropostasNovasResponse = z.infer<typeof propostasNovasResponseSchema>;

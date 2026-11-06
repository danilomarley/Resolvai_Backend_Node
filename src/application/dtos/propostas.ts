import { z } from 'zod';
import { dataIso } from './validacao.js';
import { propostaResponseSchema } from './pedidos.js';

export const ordenacoesPropostas = ['price', 'deadline', 'rating'] as const;
export const direcoesPropostas = ['asc', 'desc'] as const;

export type OrdenacaoPropostas = (typeof ordenacoesPropostas)[number];
export type DirecaoPropostas = (typeof direcoesPropostas)[number];

// Aceita o valor sem diferenciar maiúsculas, como o filtro de status de GET /api/v1/orders.
const valorDaQuery = <T extends string>(campo: string, validos: readonly T[]) =>
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

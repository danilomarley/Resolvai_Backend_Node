import { z } from 'zod';

export const criarAvaliacaoSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(2000).optional()
}).strict();
export const avaliacaoSchema = z.object({
  orderId: z.uuid(), providerId: z.uuid(), rating: z.number().int().min(1).max(5),
  comment: z.string().optional(), createdAt: z.iso.datetime()
});
export const resumoAvaliacoesSchema = z.object({ count: z.number().int().nonnegative(), averageRating: z.number().min(1).max(5).nullable() });
export type CriarAvaliacao = z.infer<typeof criarAvaliacaoSchema>;
export type Avaliacao = z.infer<typeof avaliacaoSchema>;
export type ResumoAvaliacoes = z.infer<typeof resumoAvaliacoesSchema>;

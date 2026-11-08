import { z } from 'zod';
import { paginaResponseSchema } from './common.js';
import { especialidadeResponseSchema } from './fornecedores.js';
import { fotoPedidoResponseSchema, listarPedidosQuerySchema } from './pedidos.js';
import { dataIso } from './validacao.js';

export const listarOportunidadesQuerySchema = listarPedidosQuerySchema.pick({ page: true, pageSize: true }).extend({
  search: z.string().trim().max(200).default(''),
  category: z.string().trim().max(100).default(''),
  sort: z.enum(['recent', 'proposals']).default('recent')
}).strict();

export type ListarOportunidadesQuery = z.output<typeof listarOportunidadesQuerySchema>;

export const oportunidadeResumoSchema = z.object({
  id: z.guid(),
  title: z.string(),
  category: z.string(),
  specialtyCode: z.string(),
  location: z.string().optional(),
  urgency: z.string().optional(),
  createdAt: dataIso,
  proposalsCount: z.number().int().nonnegative()
});
export type OportunidadeResumo = z.infer<typeof oportunidadeResumoSchema>;

export const oportunidadesResponseSchema = paginaResponseSchema(oportunidadeResumoSchema).extend({
  specialties: z.array(especialidadeResponseSchema)
});
export type OportunidadesResponse = z.infer<typeof oportunidadesResponseSchema>;

export const oportunidadeDetalheSchema = oportunidadeResumoSchema.extend({
  description: z.string(),
  details: z.string().optional(),
  specifications: z.string().optional(),
  photos: z.array(fotoPedidoResponseSchema),
  client: z.object({
    name: z.string(),
    memberSince: dataIso,
    ordersCount: z.number().int().nonnegative(),
    completedOrdersCount: z.number().int().nonnegative()
  })
});
export type OportunidadeDetalhe = z.infer<typeof oportunidadeDetalheSchema>;

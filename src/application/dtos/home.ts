import { z } from 'zod';
import { pedidoResumoResponseSchema } from './pedidos.js';

/**
 * active = pending + inProgress. createdLast7Days usa o relógio do banco.
 */
export const contagemPedidosResponseSchema = z.object({
  total: z.number().int(),
  pending: z.number().int(),
  inProgress: z.number().int(),
  completed: z.number().int(),
  cancelled: z.number().int(),
  active: z.number().int(),
  createdLast7Days: z.number().int()
});

/**
 * awaitingDecision considera propostas de pedidos Pending; unviewed, as dessas que ainda estão enviadas.
 */
export const contagemPropostasResponseSchema = z.object({
  total: z.number().int(),
  awaitingDecision: z.number().int(),
  unviewed: z.number().int()
});

export const resumoHomeResponseSchema = z.object({
  orders: contagemPedidosResponseSchema,
  proposals: contagemPropostasResponseSchema,
  recentOrders: z.array(pedidoResumoResponseSchema)
});

export type ContagemPedidosResponse = z.infer<typeof contagemPedidosResponseSchema>;
export type ContagemPropostasResponse = z.infer<typeof contagemPropostasResponseSchema>;
export type ResumoHomeResponse = z.infer<typeof resumoHomeResponseSchema>;

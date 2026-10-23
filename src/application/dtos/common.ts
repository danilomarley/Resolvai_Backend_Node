import { z } from 'zod';

export interface PaginaResponse<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export function criarPagina<T>(items: T[], page: number, pageSize: number, totalItems: number): PaginaResponse<T> {
  return { items, page, pageSize, totalItems, totalPages: Math.ceil(totalItems / pageSize) };
}

export const paginaResponseSchema = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    page: z.number().int(),
    pageSize: z.number().int(),
    totalItems: z.number().int(),
    totalPages: z.number().int()
  });

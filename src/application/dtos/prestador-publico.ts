import { z } from 'zod';

export const prestadorPublicoSchema = z.object({
  id: z.uuid(), name: z.string(), photoUrl: z.url().nullable(),
  categories: z.array(z.string()).nullable(), region: z.string().nullable(),
  completedServices: z.number().int().nonnegative(), reviewsAvailable: z.boolean(),
  reviewsCount: z.number().int().nonnegative().nullable(),
  averageRating: z.number().min(1).max(5).nullable(),
  reviews: z.array(z.object({ rating: z.number().int().min(1).max(5), comment: z.string().optional(), createdAt: z.iso.datetime() }))
});
export type PrestadorPublico = z.infer<typeof prestadorPublicoSchema>;

import { z } from 'zod';

export const fotoEnviadaResponseSchema = z.object({
  url: z.string().describe('URL pública da foto. Envie em fotos[].url ao criar o pedido.')
});

export type FotoEnviadaResponse = z.infer<typeof fotoEnviadaResponseSchema>;

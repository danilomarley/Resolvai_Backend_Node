import { z } from 'zod';

const mensagemSchema = z.object({
  role: z.enum(['user', 'assistant'], { error: "O campo Role deve ser 'user' ou 'assistant'." }),
  content: z
    .string({ error: 'O campo Content é obrigatório.' })
    .refine(valor => valor.trim().length > 0, { message: 'O campo Content é obrigatório.' })
    .refine(valor => valor.length <= 2000, { message: 'Cada mensagem deve ter no máximo 2000 caracteres.' })
});

/**
 * Conversa completa até agora (a API não guarda histórico): mensagens do cliente e respostas anteriores do assistente.
 */
export const assistenteRequestSchema = z.object({
  messages: z
    .array(mensagemSchema)
    .min(1, 'Envie ao menos uma mensagem.')
    .max(30, 'A conversa pode ter no máximo 30 mensagens.')
    .refine(mensagens => mensagens[0]?.role === 'user' && mensagens.at(-1)?.role === 'user', {
      message: 'A conversa deve começar e terminar com uma mensagem do cliente (role user).'
    })
});

export type AssistenteRequest = z.output<typeof assistenteRequestSchema>;

/**
 * As chaves de scope são as mesmas do corpo de POST /api/v1/orders, para preencher o formulário direto.
 */
export const assistenteResponseSchema = z.object({
  reply: z.string().describe('Mensagem do assistente para exibir ao cliente.'),
  scope: z.object({
    titulo: z.string().optional(),
    categoria: z.string().optional(),
    descricao: z.string().optional(),
    localizacao: z.string().optional(),
    detalhes: z.string().optional(),
    urgencia: z.string().optional(),
    especificacoes: z.string().optional()
  }),
  complete: z.boolean().describe('true quando categoria, descrição e localização já foram informadas.')
});

export type AssistenteResponse = z.infer<typeof assistenteResponseSchema>;

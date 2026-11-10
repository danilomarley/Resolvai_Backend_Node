import { z } from 'zod';
import { userResponseSchema } from './users.js';
import { dataIso, emailAddress, obrigatorio, textoObrigatorio } from './validacao.js';

export const loginRequestSchema = z.object({
  email: obrigatorio('Email').pipe(emailAddress('Email')).pipe(textoObrigatorio('Email', 320)),
  password: textoObrigatorio('Password', 128)
});

export type LoginRequest = z.output<typeof loginRequestSchema>;

export const refreshRequestSchema = z.object({ refreshToken: textoObrigatorio('RefreshToken', 4096) });

/**
 * Auto-cadastro público. O papel é sempre Cliente; promoção só por um Admin.
 */
export const registerRequestSchema = z.object({
  name: textoObrigatorio('Name', 200),
  email: obrigatorio('Email').pipe(emailAddress('Email')).pipe(textoObrigatorio('Email', 320)),
  password: textoObrigatorio('Password', 128, 8)
});

export type RegisterRequest = z.output<typeof registerRequestSchema>;

export const loginResponseSchema = z.object({
  accessToken: z.string(),
  tokenType: z.string(),
  expiresAtUtc: dataIso,
  refreshToken: z.string().optional(),
  user: userResponseSchema
});

export type LoginResponse = z.infer<typeof loginResponseSchema>;

/** Provider portal context; the account's original role remains unchanged. */
export const providerLoginResponseSchema = loginResponseSchema.extend({
  providerProfileStatus: z.enum(['pending', 'active'])
});
export type ProviderLoginResponse = z.infer<typeof providerLoginResponseSchema>;

/**
 * Resposta pública uniforme, sem revelar a existência da conta.
 */
export const verificarEmailRequestSchema = z.object({
  email: obrigatorio('Email').pipe(emailAddress('Email')).pipe(textoObrigatorio('Email', 320))
});

export type VerificarEmailRequest = z.output<typeof verificarEmailRequestSchema>;

export const recuperarSenhaRequestSchema = verificarEmailRequestSchema.extend({
  redirectTo: z.url().max(2048)
});

export const alterarSenhaRequestSchema = z.object({
  newPassword: textoObrigatorio('NewPassword', 128, 8)
}).strict();

export type AlterarSenhaRequest = z.output<typeof alterarSenhaRequestSchema>;

export const redefinirSenhaRequestSchema = alterarSenhaRequestSchema.extend({
  email: obrigatorio('Email').pipe(emailAddress('Email')).pipe(textoObrigatorio('Email', 320)),
  token: z.string().regex(/^\d{6}$/, 'Informe o código de recuperação de 6 dígitos.')
});

export type RedefinirSenhaRequest = z.output<typeof redefinirSenhaRequestSchema>;

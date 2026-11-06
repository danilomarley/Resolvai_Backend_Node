import { z } from 'zod';
import { userResponseSchema } from './users.js';
import { dataIso, emailAddress, obrigatorio, textoObrigatorio } from './validacao.js';

export const loginRequestSchema = z.object({
  email: obrigatorio('Email').pipe(emailAddress('Email')).pipe(textoObrigatorio('Email', 320)),
  password: textoObrigatorio('Password', 128)
});

export type LoginRequest = z.output<typeof loginRequestSchema>;

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

/**
 * Solicita recuperação sem revelar se o e-mail está cadastrado.
 */
export const verificarEmailRequestSchema = z.object({
  email: obrigatorio('Email').pipe(emailAddress('Email')).pipe(textoObrigatorio('Email', 320))
});

export type VerificarEmailRequest = z.output<typeof verificarEmailRequestSchema>;

export const redefinirSenhaRequestSchema = z.object({
  email: obrigatorio('Email').pipe(emailAddress('Email')).pipe(textoObrigatorio('Email', 320)),
  token: z.string().regex(/^\d{6}$/, 'Informe o código de recuperação de 6 dígitos.'),
  newPassword: textoObrigatorio('NewPassword', 128, 8)
}).strict();

export type RedefinirSenhaRequest = z.output<typeof redefinirSenhaRequestSchema>;

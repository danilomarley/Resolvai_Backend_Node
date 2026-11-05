import { randomUUID } from 'node:crypto';
import type { ISupabaseAuthClient, SupabaseAuthUser, SupabaseSession } from '../../application/contracts.js';
import { ConflictException, ServicoIndisponivelException, UnauthorizedException } from '../../application/errors.js';
import { DomainException } from '../../domain/errors.js';

export interface SupabaseAuthOptions {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
}

interface UserDto {
  id?: string;
  email?: string | null;
  identities?: unknown[];
  user_metadata?: { registration_attempt?: string };
}

interface TokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  expires_at?: number | null;
  refresh_token?: string | null;
  user?: UserDto | null;
}

interface SignUpResponse extends UserDto {
  user?: UserDto | null;
}

const guidVazio = '00000000-0000-0000-0000-000000000000';
const timeoutMs = 100_000; // Mesmo timeout padrão do HttpClient da API C#.

/**
 * Chamadas HTTP ao GoTrue (Supabase Auth): login, signup público e criação administrativa.
 */
export class SupabaseAuthClient implements ISupabaseAuthClient {
  private readonly baseUrl: string;

  constructor(
    private readonly options: SupabaseAuthOptions,
    private readonly fetcher: typeof fetch = fetch
  ) {
    this.baseUrl = `${options.url.replace(/\/+$/, '')}/`;
  }

  async signInWithPassword(email: string, password: string): Promise<SupabaseSession> {
    const response = await this.send('auth/v1/token?grant_type=password', this.options.anonKey, { email, password });
    const payload = await response.text();

    if ([400, 401, 403].includes(response.status)) {
      throw new UnauthorizedException();
    }

    ensureSuccess(response, 'Falha ao autenticar no Supabase.');

    const body = deserialize<TokenResponse>(payload);
    if (!body) {
      throw new UnauthorizedException();
    }

    return toSession(body);
  }

  async signUp(email: string, password: string, name: string): Promise<SupabaseAuthUser> {
    const attempt = randomUUID();
    const response = await this.send('auth/v1/signup', this.options.anonKey, { email, password, data: { name, registration_attempt: attempt } });
    const payload = await response.text();

    if (isConflict(response, payload)) {
      return this.recoverUser(email, password);
    }

    ensureSuccess(response, 'Falha ao registrar no Supabase Auth.');

    const body = deserialize<SignUpResponse>(payload);
    if (!body) {
      throw new DomainException('Resposta inválida do Supabase Auth no signup.');
    }

    const user = body.user ?? (isGuid(body.id) ? body : null);
    if (!user || !isGuid(user.id) || user.email?.toLowerCase() !== email.toLowerCase()) {
      throw new DomainException('Supabase Auth não devolveu o identificador do usuário.');
    }

    // Supabase may deliberately return an obfuscated user for an existing address.
    // The nonce only identifies this creation; it never grants a role.
    if (user.identities?.length && user.user_metadata?.registration_attempt === attempt) {
      return { id: user.id.toLowerCase(), email: user.email };
    }
    return this.recoverUser(email, password);
  }

  async refreshSession(refreshToken: string): Promise<SupabaseSession> {
    const response = await this.send('auth/v1/token?grant_type=refresh_token', this.options.anonKey, { refresh_token: refreshToken });
    const payload = await response.text();
    if ([400, 401, 403, 422].includes(response.status)) throw new UnauthorizedException('Sessão expirada. Entre novamente.');
    ensureSuccess(response, 'Falha ao renovar a sessão.');
    const body = deserialize<TokenResponse>(payload);
    if (!body) throw new UnauthorizedException();
    return toSession(body);
  }

  private async recoverUser(email: string, password: string): Promise<SupabaseAuthUser> {
    try {
      const session = await this.signInWithPassword(email, password);
      if (session.user.email.toLowerCase() !== email.toLowerCase()) throw new UnauthorizedException();
      return session.user;
    } catch (error) {
      if (error instanceof UnauthorizedException) throw new ConflictException('Não foi possível retomar o cadastro. Confirme seu e-mail e tente novamente com as mesmas credenciais.');
      throw error;
    }
  }

  async adminCreateUser(email: string, password: string, name: string): Promise<SupabaseAuthUser> {
    const response = await this.send('auth/v1/admin/users', this.options.serviceRoleKey, {
      email,
      password,
      email_confirm: true,
      user_metadata: { name }
    });
    const payload = await response.text();

    if (isConflict(response, payload)) {
      throw new ConflictException(`Já existe um usuário com o e-mail '${email}'.`);
    }

    ensureSuccess(response, 'Falha ao criar usuário no Supabase Auth.');

    const body = deserialize<UserDto>(payload);
    if (!body) {
      throw new DomainException('Resposta inválida do Supabase Auth na criação administrativa.');
    }

    if (!isGuid(body.id)) {
      throw new DomainException('Supabase Auth não devolveu o identificador do usuário.');
    }

    return { id: body.id!.toLowerCase(), email: body.email ?? email };
  }

  async adminUpdatePassword(userId: string, password: string): Promise<void> {
    const response = await this.send(`auth/v1/admin/users/${encodeURIComponent(userId)}`, this.options.serviceRoleKey, { password }, 'PUT');
    await response.text();
    if (response.status === 422) {
      throw new DomainException('A nova senha não atende às regras de segurança do Supabase Auth.');
    }

    ensureSuccess(response, 'Falha ao redefinir a senha no Supabase Auth.');
  }

  private async send(path: string, key: string, body: unknown, method = 'POST'): Promise<Response> {
    try {
      return await this.fetcher(new URL(path, this.baseUrl), {
        method,
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch {
      throw new ServicoIndisponivelException('Supabase Auth indisponível. Tente novamente.');
    }
  }
}

function isConflict(response: Response, payload: string): boolean {
  const body = deserialize<{ error_code?: string; code?: string }>(payload);
  return [400, 422].includes(response.status) && ['user_already_exists', 'email_exists'].includes(body?.error_code ?? body?.code ?? '');
}

function ensureSuccess(response: Response, errorMessage: string): void {
  if (response.ok) {
    return;
  }

  if (response.status >= 500 || response.status === 429) throw new ServicoIndisponivelException(errorMessage);
  throw new DomainException(`${errorMessage} Status=${response.status}.`);
}

function deserialize<T>(payload: string): T | null {
  try {
    return JSON.parse(payload) as T;
  } catch {
    return null;
  }
}

function isGuid(value: string | undefined | null): value is string {
  return !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) && value !== guidVazio;
}

function toSession(body: TokenResponse): SupabaseSession {
  if (!body.access_token?.trim() || !body.user || !isGuid(body.user.id)) {
    throw new UnauthorizedException();
  }

  const expiresAtUtc =
    body.expires_at && body.expires_at > 0
      ? new Date(body.expires_at * 1000)
      : new Date(Date.now() + (body.expires_in && body.expires_in > 0 ? body.expires_in : 3600) * 1000);

  return {
    accessToken: body.access_token,
    // Ausente vira "bearer" (padrão do GoTrue); presente mas vazio vira "Bearer", como na API C#.
    tokenType: body.token_type === undefined ? 'bearer' : body.token_type.trim() ? body.token_type : 'Bearer',
    expiresAtUtc,
    refreshToken: body.refresh_token ?? null,
    user: { id: body.user.id!.toLowerCase(), email: body.user.email ?? '' }
  };
}

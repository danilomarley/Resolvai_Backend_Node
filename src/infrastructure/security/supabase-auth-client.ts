import type { ISupabaseAuthClient, SupabaseAuthUser, SupabaseSession } from '../../application/contracts.js';
import { ConflictException, ForbiddenException, ServicoIndisponivelException, UnauthorizedException } from '../../application/errors.js';
import { DomainException } from '../../domain/errors.js';

export interface SupabaseAuthOptions {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
}

interface UserDto {
  id?: string;
  email?: string | null;
}

interface TokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  expires_at?: number | null;
  refresh_token?: string | null;
  user?: UserDto | null;
}

interface RegistrationSettings {
  disable_signup: boolean;
  external: { email: boolean };
  mailer_autoconfirm: boolean;
}

const guidVazio = '00000000-0000-0000-0000-000000000000';
const timeoutMs = 100_000; // Mesmo timeout padrão do HttpClient da API C#.

/**
 * GoTrue: login, cadastro create-if-new limitado à política do projeto e provisionamento Admin.
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
    const settings = await this.registrationSettings();
    let response: Response;
    let payload: string;
    try {
      // Public /signup can replace the password of an existing unconfirmed user.
      // POST admin/users only creates new users; never update/delete an existing account.
      response = await this.send('auth/v1/admin/users', this.options.serviceRoleKey, {
        email, password, email_confirm: settings.mailer_autoconfirm, user_metadata: { name }
      });
      payload = await response.text();
    } catch {
      return this.recoverUser(email, password, true);
    }
    if (isConflict(response, payload)) return this.recoverUser(email, password);
    if (response.status >= 500) return this.recoverUser(email, password, true);
    ensureSuccess(response, 'Falha ao registrar no Supabase Auth.');
    const user = deserialize<UserDto>(payload);
    if (!user || !isGuid(user.id) || user.email?.toLowerCase() !== email.toLowerCase()) {
      return this.recoverUser(email, password, true);
    }
    // Admin creation sends no email. Preserve the project's existing confirmation policy.
    if (!settings.mailer_autoconfirm) await this.resendConfirmation(email);
    return { id: user.id.toLowerCase(), email: user.email };
  }

  private async registrationSettings(): Promise<RegistrationSettings> {
    let settings: RegistrationSettings | null;
    try {
      const response = await this.send('auth/v1/settings', this.options.anonKey, undefined, 'GET');
      if (!response.ok) throw new Error('Settings unavailable');
      settings = deserialize<RegistrationSettings>(await response.text());
      if (!settings || typeof settings.disable_signup !== 'boolean' || typeof settings.external?.email !== 'boolean'
        || typeof settings.mailer_autoconfirm !== 'boolean') throw new Error('Invalid registration settings');
    } catch {
      throw new ServicoIndisponivelException('Não foi possível confirmar a política de cadastro do Supabase Auth. Tente novamente.');
    }
    if (settings.disable_signup || !settings.external.email) throw new ForbiddenException('O cadastro por e-mail está desabilitado neste projeto.');
    return settings;
  }

  private async resendConfirmation(email: string): Promise<void> {
    try {
      const response = await this.send('auth/v1/resend', this.options.anonKey, { type: 'signup', email });
      await response.text();
      if (response.ok) return;
    } catch { /* Keep confirmation delivery failure visible without exposing transport details. */ }
    throw new ServicoIndisponivelException('Não foi possível enviar a confirmação de e-mail. Tente novamente com as credenciais originais.');
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

  private async recoverUser(email: string, password: string, unknownCreation = false): Promise<SupabaseAuthUser> {
    try {
      const session = await this.signInWithPassword(email, password);
      if (session.user.email.toLowerCase() !== email.toLowerCase()) throw new UnauthorizedException();
      return session.user;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        await this.resendConfirmation(email);
        if (unknownCreation) throw new ServicoIndisponivelException('Resultado do cadastro não confirmado. Confirme seu e-mail e tente novamente com as credenciais originais.');
        throw new ConflictException('Não foi possível retomar o cadastro. Confirme seu e-mail e tente novamente com as mesmas credenciais.');
      }
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
        body: body === undefined ? undefined : JSON.stringify(body),
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

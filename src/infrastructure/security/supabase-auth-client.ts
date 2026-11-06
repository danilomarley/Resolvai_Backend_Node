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

    if (response.status === 400 || response.status === 401) {
      throw new UnauthorizedException();
    }

    ensureSuccess(response, payload, 'Falha ao autenticar no Supabase.');

    const body = deserialize<TokenResponse>(payload);
    if (!body) {
      throw new UnauthorizedException();
    }

    return toSession(body);
  }

  async signUp(email: string, password: string, name: string): Promise<SupabaseAuthUser> {
    const response = await this.send('auth/v1/signup', this.options.anonKey, { email, password, data: { name } });
    const payload = await response.text();

    if (isConflict(response, payload)) {
      throw new ConflictException(`Já existe um usuário com o e-mail '${email}'.`);
    }

    ensureSuccess(response, payload, 'Falha ao registrar no Supabase Auth.');

    const body = deserialize<SignUpResponse>(payload);
    if (!body) {
      throw new DomainException('Resposta inválida do Supabase Auth no signup.');
    }

    const user = body.user ?? (isGuid(body.id) ? { id: body.id, email: body.email } : null);
    if (!user || !isGuid(user.id)) {
      throw new DomainException('Supabase Auth não devolveu o identificador do usuário.');
    }

    return { id: user.id!.toLowerCase(), email: user.email ?? email };
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

    ensureSuccess(response, payload, 'Falha ao criar usuário no Supabase Auth.');

    const body = deserialize<UserDto>(payload);
    if (!body) {
      throw new DomainException('Resposta inválida do Supabase Auth na criação administrativa.');
    }

    if (!isGuid(body.id)) {
      throw new DomainException('Supabase Auth não devolveu o identificador do usuário.');
    }

    return { id: body.id!.toLowerCase(), email: body.email ?? email };
  }

  async requestPasswordRecovery(email: string): Promise<void> {
    const response = await this.recoveryRequest('recover', { email });
    // O contrato de solicitação não distingue conta ausente, bloqueio ou limite do provedor.
    if (!response.ok && ![400, 404, 422, 429].includes(response.status)) throw recoveryUnavailable();
  }

  async verifyPasswordRecovery(email: string, token: string): Promise<SupabaseSession> {
    const response = await this.recoveryRequest('verify', { type: 'recovery', email, token });
    if ([400, 401, 403, 404, 422, 429].includes(response.status)) throw invalidRecovery();
    if (!response.ok) throw recoveryUnavailable();
    const body = deserialize<TokenResponse>(await response.text());
    if (!body) throw invalidRecovery();
    const session = toSession(body);
    if (session.expiresAtUtc.getTime() <= Date.now()) throw invalidRecovery();
    return session;
  }

  async updateOwnPassword(accessToken: string, password: string): Promise<void> {
    const response = await this.recoveryRequest('user', { password }, 'PUT', accessToken);
    if ([401, 403].includes(response.status)) throw invalidRecovery();
    if ([400, 422].includes(response.status)) throw new DomainException('A nova senha não atende às regras de segurança. Solicite outro código e tente novamente.');
    if (!response.ok) throw recoveryUnavailable();
    // Encerra as sessões de atualização/refresh. JWTs já emitidos expiram conforme a política do provedor.
    const logout = await this.recoveryRequest('logout?scope=global', undefined, 'POST', accessToken);
    if (!logout.ok && logout.status !== 401) throw recoveryUnavailable();
  }

  private async recoveryRequest(path: string, body: unknown, method = 'POST', token = this.options.anonKey): Promise<Response> {
    try {
      return await this.fetcher(new URL(`auth/v1/${path}`, this.baseUrl), {
        method, headers: { apikey: this.options.anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000)
      });
    } catch { throw recoveryUnavailable(); }
  }

  private send(path: string, key: string, body: unknown, method = 'POST'): Promise<Response> {
    return this.fetcher(new URL(path, this.baseUrl), {
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
  }
}

const invalidRecovery = () => new UnauthorizedException('Código inválido ou expirado.');
const recoveryUnavailable = () => new ServicoIndisponivelException('Não foi possível processar a recuperação de senha. Tente novamente mais tarde.');

function isConflict(response: Response, payload: string): boolean {
  return response.status === 422 || (response.status === 400 && payload.toLowerCase().includes('already'));
}

function ensureSuccess(response: Response, payload: string, errorMessage: string): void {
  if (response.ok) {
    return;
  }

  throw new DomainException(`${errorMessage} Status=${response.status}. Detalhe=${truncate(payload)}`);
}

function deserialize<T>(payload: string): T | null {
  try {
    return JSON.parse(payload) as T;
  } catch {
    return null;
  }
}

function truncate(value: string): string {
  return value.length <= 300 ? value : value.slice(0, 300);
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

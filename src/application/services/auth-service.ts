import { Email } from '../../domain/email.js';
import { UserRole } from '../../domain/enums.js';
import { User } from '../../domain/user.js';
import type { CurrentUser, IFornecedorRepository, ISupabaseAuthClient, IUserRepository, SupabaseSession } from '../contracts.js';
import type { AlterarSenhaRequest, LoginRequest, LoginResponse, RedefinirSenhaRequest, RegisterRequest, VerificarEmailRequest } from '../dtos/auth.js';
import type { UserResponse } from '../dtos/users.js';
import { ConflictException, ForbiddenException, NotFoundException, UnauthorizedException } from '../errors.js';
import { toUserResponse } from '../mappings/user-mapper.js';

export class AuthService {
  constructor(
    private readonly userRepository: IUserRepository,
    private readonly supabaseAuthClient: ISupabaseAuthClient,
    private readonly fornecedores?: IFornecedorRepository
  ) {}

  async login(request: LoginRequest): Promise<LoginResponse> {
    const email = Email.tryCreate(request.email);
    if (!email) {
      throw new UnauthorizedException();
    }

    const session = await this.supabaseAuthClient.signInWithPassword(email.value, request.password);
    return this.toResponse(session);
  }

  async loginProvider(request: LoginRequest): Promise<LoginResponse> {
    const response = await this.login(request);
    if (response.user.role !== UserRole.Prestador) throw new ForbiddenException();
    await this.exigirPerfilFornecedor(response.user.id);
    return response;
  }

  async refresh(refreshToken: string): Promise<LoginResponse> {
    const response = await this.toResponse(await this.supabaseAuthClient.refreshSession(refreshToken));
    if (response.user.role === UserRole.Prestador) await this.exigirPerfilFornecedor(response.user.id);
    return response;
  }

  private async exigirPerfilFornecedor(id: string): Promise<void> {
    if (!this.fornecedores || !await this.fornecedores.getByUsuarioId(id)) throw new NotFoundException('Fornecedor', id);
  }

  private async toResponse(session: SupabaseSession): Promise<LoginResponse> {

    const user = await this.userRepository.getById(session.user.id);

    if (!user || !user.isActive) {
      throw new UnauthorizedException(user ? 'Usuário inativo.' : 'Usuário autenticado no Supabase sem perfil local.');
    }

    return {
      accessToken: session.accessToken,
      tokenType: session.tokenType,
      expiresAtUtc: session.expiresAtUtc.toISOString(),
      refreshToken: session.refreshToken ?? undefined,
      user: toUserResponse(user)
    };
  }

  async register(request: RegisterRequest): Promise<UserResponse> {
    const email = Email.create(request.email);

    if (await this.userRepository.existsByEmail(email)) {
      throw new ConflictException(`Já existe um usuário com o e-mail '${email.value}'.`);
    }

    const authUser = await this.supabaseAuthClient.signUp(email.value, request.password, request.name);

    const user = User.register(authUser.id, request.name, email, UserRole.Cliente);
    await this.userRepository.add(user);

    return toUserResponse(user);
  }

  /** O provedor envia a prova por e-mail; não consultamos existência no banco local. */
  async verificarEmail(request: VerificarEmailRequest): Promise<void> {
    await this.supabaseAuthClient.requestPasswordRecovery(Email.create(request.email).value);
  }

  async solicitarRecuperacao(email: string, redirectTo: string): Promise<void> {
    await this.supabaseAuthClient.requestPasswordRecovery(Email.create(email).value, redirectTo);
  }

  /** O OTP é consumido pelo Supabase; a atualização usa somente a sessão verificada. */
  async redefinirSenha(request: RedefinirSenhaRequest): Promise<void> {
    if (!/^\d{6}$/.test(request.token ?? '')) throw new UnauthorizedException('Código inválido ou expirado.');
    const email = Email.create(request.email).value;
    const session = await this.supabaseAuthClient.verifyPasswordRecovery(email, request.token);
    const user = await this.userRepository.getById(session.user.id);
    if (!user?.isActive || user.email.value !== email || session.user.email.toLowerCase() !== email) {
      throw new UnauthorizedException('Código inválido ou expirado.');
    }
    await this.supabaseAuthClient.updateOwnPassword(session.accessToken, request.newPassword);
  }

  /** A sessão Bearer verificada altera a própria senha, sem operação administrativa. */
  async alterarSenha(request: AlterarSenhaRequest, currentUser: CurrentUser, accessToken: string): Promise<void> {
    if (!currentUser.isAuthenticated || !currentUser.id || !accessToken.trim()) throw new UnauthorizedException();
    const user = await this.userRepository.getById(currentUser.id);
    if (!user?.isActive) throw new UnauthorizedException();
    await this.supabaseAuthClient.updateOwnPassword(accessToken, request.newPassword);
  }
}

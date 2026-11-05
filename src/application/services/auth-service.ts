import { Email } from '../../domain/email.js';
import { UserRole } from '../../domain/enums.js';
import { User } from '../../domain/user.js';
import type { CurrentUser, IFornecedorRepository, ISupabaseAuthClient, IUserRepository, SupabaseSession } from '../contracts.js';
import type { LoginRequest, LoginResponse, RedefinirSenhaRequest, RegisterRequest, VerificarEmailRequest } from '../dtos/auth.js';
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

  /** Resposta pública uniforme, sem consultar a existência da conta. */
  async verificarEmail(_request: VerificarEmailRequest): Promise<void> {
  }

  /** Somente o sujeito de um Bearer verificado pode alterar sua senha. */
  async redefinirSenha(request: RedefinirSenhaRequest, currentUser: CurrentUser): Promise<void> {
    if (!currentUser.isAuthenticated || !currentUser.id) throw new UnauthorizedException();
    const user = await this.userRepository.getById(currentUser.id);
    if (!user || !user.isActive) throw new UnauthorizedException();
    await this.supabaseAuthClient.adminUpdatePassword(user.id, request.newPassword);
  }
}

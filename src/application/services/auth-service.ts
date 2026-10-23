import { Email } from '../../domain/email.js';
import { UserRole } from '../../domain/enums.js';
import { User } from '../../domain/user.js';
import type { ISupabaseAuthClient, IUserRepository } from '../contracts.js';
import type { LoginRequest, LoginResponse, RegisterRequest } from '../dtos/auth.js';
import type { UserResponse } from '../dtos/users.js';
import { ConflictException, UnauthorizedException } from '../errors.js';
import { toUserResponse } from '../mappings/user-mapper.js';

export class AuthService {
  constructor(
    private readonly userRepository: IUserRepository,
    private readonly supabaseAuthClient: ISupabaseAuthClient
  ) {}

  async login(request: LoginRequest): Promise<LoginResponse> {
    const email = Email.tryCreate(request.email);
    if (!email) {
      throw new UnauthorizedException();
    }

    const session = await this.supabaseAuthClient.signInWithPassword(email.value, request.password);

    const user =
      (await this.userRepository.getById(session.user.id)) ?? (await this.userRepository.getByEmail(email));

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
}

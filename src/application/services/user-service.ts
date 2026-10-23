import { Contato } from '../../domain/contato.js';
import { Email } from '../../domain/email.js';
import { Endereco } from '../../domain/endereco.js';
import { UserRole } from '../../domain/enums.js';
import { User } from '../../domain/user.js';
import type {
  CurrentUser,
  IContatoRepository,
  IEnderecoRepository,
  ISupabaseAuthClient,
  IUserRepository
} from '../contracts.js';
import type { CompleteRegistrationRequest, CreateUserRequest, UserResponse } from '../dtos/users.js';
import { ConflictException, NotFoundException, UnauthorizedException } from '../errors.js';
import { toUserResponse } from '../mappings/user-mapper.js';

export class UserService {
  constructor(
    private readonly userRepository: IUserRepository,
    private readonly enderecoRepository: IEnderecoRepository,
    private readonly contatoRepository: IContatoRepository,
    private readonly supabaseAuthClient: ISupabaseAuthClient
  ) {}

  async create(request: CreateUserRequest): Promise<UserResponse> {
    const email = Email.create(request.email);

    if (await this.userRepository.existsByEmail(email)) {
      throw new ConflictException(`Já existe um usuário com o e-mail '${email.value}'.`);
    }

    const authUser = await this.supabaseAuthClient.adminCreateUser(email.value, request.password, request.name);

    const user = User.register(authUser.id, request.name, email, request.role);
    await this.userRepository.add(user);

    return toUserResponse(user);
  }

  async getById(id: string): Promise<UserResponse> {
    const user = await this.userRepository.getById(id);
    if (!user) {
      throw new NotFoundException('Usuário', id);
    }

    return toUserResponse(user);
  }

  async getCurrent(currentUser: CurrentUser): Promise<UserResponse> {
    const id = currentUser.id;
    if (!id) {
      throw new UnauthorizedException('Token sem identificação de usuário.');
    }

    return this.getById(id);
  }

  async getAll(): Promise<UserResponse[]> {
    const users = await this.userRepository.getAll();
    return users.map(toUserResponse);
  }

  async setActive(id: string, isActive: boolean): Promise<UserResponse> {
    const user = await this.userRepository.getById(id);
    if (!user) {
      throw new NotFoundException('Usuário', id);
    }

    if (isActive) {
      user.activate();
    } else {
      user.deactivate();
    }

    await this.userRepository.update(user);

    return toUserResponse(user);
  }

  async completeRegistration(currentUser: CurrentUser, request: CompleteRegistrationRequest): Promise<UserResponse> {
    const id = currentUser.id;
    if (!id) {
      throw new UnauthorizedException('Token sem identificação de usuário.');
    }

    let user = await this.userRepository.getById(id);

    if (!user) {
      const email = Email.create(currentUser.email);
      user = User.register(id, request.name, email, UserRole.Cliente);
      await this.userRepository.add(user);
    }

    if (user.cpf?.trim()) {
      throw new ConflictException('Cadastro já finalizado.');
    }

    const cpf = onlyDigits(request.cpf);

    if (await this.userRepository.existsByCpf(cpf, id)) {
      throw new ConflictException(`Já existe um usuário com o CPF '${request.cpf}'.`);
    }

    user.completeRegistration(cpf);
    await this.userRepository.update(user);

    const endereco = Endereco.register(user.id, {
      logradouro: request.endereco.logradouro,
      numero: request.endereco.numero,
      complemento: request.endereco.complemento,
      bairro: request.endereco.bairro,
      cidade: request.endereco.cidade,
      estado: request.endereco.estado.toUpperCase(),
      cep: onlyDigits(request.endereco.cep),
      apelido: request.endereco.apelido,
      latitude: request.endereco.latitude,
      longitude: request.endereco.longitude,
      principal: true
    });
    await this.enderecoRepository.add(endereco);

    const contato = Contato.register(user.id, request.contato.tipo, request.contato.valor, true);
    await this.contatoRepository.add(contato);

    return toUserResponse(user);
  }
}

function onlyDigits(value: string): string {
  return value.replace(/\D/g, '');
}

import { randomUUID } from 'node:crypto';
import { Contato } from '../../domain/contato.js';
import { Email } from '../../domain/email.js';
import { UserRole } from '../../domain/enums.js';
import { DomainException } from '../../domain/errors.js';
import { Fornecedor } from '../../domain/fornecedor.js';
import { normalizarTelefone } from '../../domain/telefone.js';
import { User } from '../../domain/user.js';
import type { CurrentUser, IEspecialidadeQueries, IFornecedorRepository, ISupabaseAuthClient, IUserRepository } from '../contracts.js';
import type { AtualizarFornecedorRequest, FornecedorResponse, RegisterFornecedorRequest } from '../dtos/fornecedores.js';
import { ConflictException, ForbiddenException, NotFoundException, ServicoIndisponivelException, UnauthorizedException } from '../errors.js';

const pendente = () => new ServicoIndisponivelException('Cadastro pendente. Confirme seu e-mail e tente novamente com os mesmos dados e credenciais.');

export class FornecedorService {
  constructor(
    private readonly users: IUserRepository,
    private readonly fornecedores: IFornecedorRepository,
    private readonly especialidades: IEspecialidadeQueries,
    private readonly auth: ISupabaseAuthClient
  ) {}

  async register(request: RegisterFornecedorRequest): Promise<FornecedorResponse> {
    const email = Email.create(request.email);
    const perfil = Fornecedor.register(randomUUID(), request.tipoPessoa, request.cnpj, request);
    User.register(perfil.idUsuario, request.name, email, UserRole.Prestador);
    const cpf = perfil.normalizeCpf(request.cpf);
    const telefone = normalizarTelefone(request.telefone);
    const codigos = await this.validarEspecialidades(request.especialidades);
    if (await this.users.existsByEmail(email)) throw new ConflictException('E-mail já cadastrado. Use uma conta distinta para cada papel.');
    if (cpf && await this.users.existsByCpf(cpf, perfil.idUsuario, UserRole.Prestador)) throw new ConflictException('Já existe prestador com este CPF.');
    if (perfil.cnpj && await this.fornecedores.existsByCnpj(perfil.cnpj)) throw new ConflictException('CNPJ já cadastrado.');

    let identidade;
    try {
      identidade = await this.auth.signUp(email.value, request.password, request.name.trim());
    } catch (error) {
      if (error instanceof ConflictException || error instanceof DomainException || error instanceof UnauthorizedException || error instanceof ForbiddenException) throw error;
      throw pendente();
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identidade.id)
      || identidade.id === '00000000-0000-0000-0000-000000000000' || identidade.email.toLowerCase() !== email.value) {
      throw new UnauthorizedException('Não foi possível confirmar a identidade da conta.');
    }
    const user = User.register(identidade.id, request.name, email, UserRole.Prestador);
    if (cpf) user.completeRegistration(cpf);
    const fornecedor = Fornecedor.register(user.id, perfil.tipoPessoa, perfil.cnpj, perfil.dados);
    const contato = Contato.register(user.id, 'whatsapp', telefone, true);
    try {
      await this.fornecedores.addComplete(user, fornecedor, contato, codigos);
    } catch (error) {
      if (error instanceof ConflictException || error instanceof DomainException) throw error;
      // Auth and SQL are separate systems. Never delete or reset an external account.
      throw pendente();
    }
    const response = await this.fornecedores.getByUsuarioId(user.id);
    if (!response) throw pendente();
    return response;
  }

  async getCurrent(current: CurrentUser): Promise<FornecedorResponse> {
    const user = await this.exigirPrestador(current);
    const profile = await this.fornecedores.getByUsuarioId(user.id);
    if (!profile) throw new NotFoundException('Fornecedor', user.id);
    return profile;
  }

  async updateCurrent(current: CurrentUser, request: AtualizarFornecedorRequest): Promise<FornecedorResponse> {
    const user = await this.exigirPrestador(current);
    const anterior = await this.fornecedores.getByUsuarioId(user.id);
    if (!anterior) throw new NotFoundException('Fornecedor', user.id);
    const fornecedor = Fornecedor.register(user.id, anterior.tipoPessoa, anterior.cnpj, request);
    const telefone = normalizarTelefone(request.telefone);
    const codigos = await this.validarEspecialidades(request.especialidades);
    user.changeName(request.name);
    await this.fornecedores.updateComplete(user, fornecedor, Contato.register(user.id, 'whatsapp', telefone, true), codigos);
    return this.getCurrent(current);
  }

  private async exigirPrestador(current: CurrentUser): Promise<User> {
    if (!current.isAuthenticated || !current.id) throw new UnauthorizedException();
    const user = await this.users.getById(current.id);
    if (!user || !user.isActive) throw new UnauthorizedException('Perfil de Prestador indisponível.');
    if (user.role !== UserRole.Prestador) throw new ForbiddenException();
    return user;
  }

  private async validarEspecialidades(values: string[]): Promise<string[]> {
    const codigos = [...new Set(values.map(value => value.trim()))].sort();
    const ativas = new Set((await this.especialidades.listActive()).map(item => item.codigo));
    if (!codigos.length || codigos.some(codigo => !ativas.has(codigo))) throw new DomainException('Há especialidades inexistentes ou inativas.');
    return codigos;
  }
}

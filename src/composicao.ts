import type { Dependencias } from './api/app.js';
import { criarVerificadorDeToken } from './api/authentication.js';
import { AssistentePedidoService } from './application/services/assistente-pedido-service.js';
import { AuthService } from './application/services/auth-service.js';
import { FornecedorService } from './application/services/fornecedor-service.js';
import { EspecialidadeQueries } from './infrastructure/repositories/especialidade-queries.js';
import { FornecedorRepository } from './infrastructure/repositories/fornecedor-repository.js';
import { FotoPedidoService } from './application/services/foto-pedido-service.js';
import { PedidoService } from './application/services/pedido-service.js';
import { PropostaService } from './application/services/proposta-service.js';
import { PrestadorService } from './application/services/prestador-service.js';
import { PropostaPrestadorService } from './application/services/proposta-prestador-service.js';
import { UserService } from './application/services/user-service.js';
import type { AppConfig } from './config/env.js';
import { createDatabase, type Database } from './infrastructure/database.js';
import { ClaudeAssistentePedido } from './infrastructure/ia/claude-assistente-pedido.js';
import { ContatoRepository } from './infrastructure/repositories/contato-repository.js';
import { EnderecoRepository } from './infrastructure/repositories/endereco-repository.js';
import { PedidoQueries } from './infrastructure/repositories/pedido-queries.js';
import { OportunidadeQueries } from './infrastructure/repositories/oportunidade-queries.js';
import { PedidoRepository } from './infrastructure/repositories/pedido-repository.js';
import { PropostaRepository } from './infrastructure/repositories/proposta-repository.js';
import { PrestadorRepository } from './infrastructure/repositories/prestador-repository.js';
import { PropostaPrestadorRepository } from './infrastructure/repositories/proposta-prestador-repository.js';
import { UserRepository } from './infrastructure/repositories/user-repository.js';
import { SupabaseAuthClient } from './infrastructure/security/supabase-auth-client.js';
import { SupabaseStorage } from './infrastructure/storage/supabase-storage.js';
import { PropostaFornecedorService } from './application/services/proposta-fornecedor-service.js';
import { PropostaFornecedorRepository } from './infrastructure/repositories/proposta-fornecedor-repository.js';
import { AvaliacaoService } from './application/services/avaliacao-service.js';
import { AvaliacaoRepository } from './infrastructure/repositories/avaliacao-repository.js';

/**
 * Raiz de composição: liga serviços, repositórios e clientes externos
 * (papel do DependencyInjection.cs das camadas Application e Infrastructure).
 */
export function criarDependencias(config: AppConfig, database: Database = createDatabase(config.database)): Dependencias & { database: Database } {
  const userRepository = new UserRepository(database);
  const supabaseAuthClient = new SupabaseAuthClient(config.supabase);
  const fornecedores = new FornecedorRepository(database);
  const especialidades = new EspecialidadeQueries(database);
  const fornecedorService = new FornecedorService(userRepository, fornecedores, especialidades, supabaseAuthClient, new OportunidadeQueries(database));
  const storage = new SupabaseStorage({ url: config.supabase.url, serviceRoleKey: config.supabase.serviceRoleKey, bucket: config.supabase.storageBucket });

  return {
    database,
    avaliacaoService: new AvaliacaoService(new AvaliacaoRepository(database)),
    userRepository,
    authService: new AuthService(userRepository, supabaseAuthClient, fornecedores),
    fornecedorService,
    propostaFornecedorService: new PropostaFornecedorService(fornecedorService, new PropostaFornecedorRepository(database), storage),
    especialidadeQueries: especialidades,
    userService: new UserService(userRepository, new EnderecoRepository(database), new ContatoRepository(database), supabaseAuthClient),
    pedidoService: new PedidoService(new PedidoQueries(database), new PedidoRepository(database), userRepository),
    propostaService: new PropostaService(new PropostaRepository(database), new PedidoQueries(database)),
    prestadorService: new PrestadorService(new PrestadorRepository(database), userRepository, fornecedores),
    propostaPrestadorService: new PropostaPrestadorService(new PropostaPrestadorRepository(database), fornecedorService, storage),
    fotoPedidoService: new FotoPedidoService(
      new SupabaseStorage({ url: config.supabase.url, serviceRoleKey: config.supabase.serviceRoleKey, bucket: config.supabase.storageBucket }),
      userRepository
    ),
    assistentePedidoService: new AssistentePedidoService(new ClaudeAssistentePedido(config.claude)),
    verificarToken: criarVerificadorDeToken(config.supabase)
  };
}

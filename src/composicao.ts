import type { Dependencias } from './api/app.js';
import { criarVerificadorDeToken } from './api/authentication.js';
import { AuthService } from './application/services/auth-service.js';
import { PedidoService } from './application/services/pedido-service.js';
import { UserService } from './application/services/user-service.js';
import type { AppConfig } from './config/env.js';
import { createDatabase, type Database } from './infrastructure/database.js';
import { ContatoRepository } from './infrastructure/repositories/contato-repository.js';
import { EnderecoRepository } from './infrastructure/repositories/endereco-repository.js';
import { PedidoQueries } from './infrastructure/repositories/pedido-queries.js';
import { PedidoRepository } from './infrastructure/repositories/pedido-repository.js';
import { UserRepository } from './infrastructure/repositories/user-repository.js';
import { SupabaseAuthClient } from './infrastructure/security/supabase-auth-client.js';

/**
 * Raiz de composição: liga serviços, repositórios e clientes externos
 * (papel do DependencyInjection.cs das camadas Application e Infrastructure).
 */
export function criarDependencias(config: AppConfig, database: Database = createDatabase(config.database)): Dependencias & { database: Database } {
  const userRepository = new UserRepository(database);
  const supabaseAuthClient = new SupabaseAuthClient(config.supabase);

  return {
    database,
    userRepository,
    authService: new AuthService(userRepository, supabaseAuthClient),
    userService: new UserService(userRepository, new EnderecoRepository(database), new ContatoRepository(database), supabaseAuthClient),
    pedidoService: new PedidoService(new PedidoQueries(database), new PedidoRepository(database), userRepository),
    verificarToken: criarVerificadorDeToken(config.supabase)
  };
}

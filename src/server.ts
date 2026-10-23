import { buildApp } from './api/app.js';
import { criarDependencias } from './composicao.js';
import { loadConfig } from './config/env.js';

const config = loadConfig();
const dependencias = criarDependencias(config);

const app = await buildApp({
  dependencias,
  corsAllowedOrigins: config.corsAllowedOrigins,
  logger: { level: config.logLevel }
});

const encerrar = async (sinal: string) => {
  app.log.info(`Recebido ${sinal}, encerrando.`);
  await app.close();
  await dependencias.database.close();
  process.exit(0);
};

process.once('SIGINT', () => void encerrar('SIGINT'));
process.once('SIGTERM', () => void encerrar('SIGTERM'));

try {
  await app.listen({ port: config.port, host: config.host });
  app.log.info(`Swagger em http://localhost:${config.port}/swagger`);
} catch (error) {
  app.log.error(error);
  await dependencias.database.close();
  process.exit(1);
}

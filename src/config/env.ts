import { z } from 'zod';

const texto = (nome: string) => z.string({ error: `${nome} não foi configurada.` }).trim().min(1, `${nome} não foi configurada.`);

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(5172),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: texto('DATABASE_URL'),
  DATABASE_SSL: z
    .enum(['true', 'false'])
    .default('true')
    .transform(valor => valor === 'true'),
  DATABASE_COMMAND_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(30),
  SUPABASE_URL: texto('SUPABASE_URL').pipe(z.url('SUPABASE_URL deve ser uma URL.')),
  SUPABASE_ANON_KEY: texto('SUPABASE_ANON_KEY'),
  SUPABASE_SERVICE_ROLE_KEY: texto('SUPABASE_SERVICE_ROLE_KEY'),
  SUPABASE_JWT_SECRET: texto('SUPABASE_JWT_SECRET'),
  SUPABASE_AUDIENCE: texto('SUPABASE_AUDIENCE').default('authenticated'),
  CORS_ALLOWED_ORIGINS: z
    .string()
    .default('')
    .transform(valor =>
      valor
        .split(',')
        .map(origem => origem.trim())
        .filter(Boolean)
    )
});

export interface AppConfig {
  port: number;
  host: string;
  logLevel: string;
  database: {
    connectionString: string;
    ssl: boolean;
    commandTimeoutSeconds: number;
  };
  supabase: {
    url: string;
    anonKey: string;
    serviceRoleKey: string;
    jwtSecret: string;
    audience: string;
    /** Emissor dos tokens do GoTrue: {url}/auth/v1. */
    authIssuer: string;
  };
  corsAllowedOrigins: string[];
}

/**
 * Lê e valida as variáveis de ambiente na inicialização, como o ValidateOnStart da API C#.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const problemas = result.error.issues.map(issue => `- ${issue.message}`).join('\n');
    throw new Error(`Configuração inválida:\n${problemas}`);
  }

  const e = result.data;
  const supabaseUrl = e.SUPABASE_URL.replace(/\/+$/, '');

  return {
    port: e.PORT,
    host: e.HOST,
    logLevel: e.LOG_LEVEL,
    database: {
      connectionString: e.DATABASE_URL,
      ssl: e.DATABASE_SSL,
      commandTimeoutSeconds: e.DATABASE_COMMAND_TIMEOUT_SECONDS
    },
    supabase: {
      url: supabaseUrl,
      anonKey: e.SUPABASE_ANON_KEY,
      serviceRoleKey: e.SUPABASE_SERVICE_ROLE_KEY,
      jwtSecret: e.SUPABASE_JWT_SECRET,
      audience: e.SUPABASE_AUDIENCE,
      authIssuer: `${supabaseUrl}/auth/v1`
    },
    corsAllowedOrigins: e.CORS_ALLOWED_ORIGINS
  };
}

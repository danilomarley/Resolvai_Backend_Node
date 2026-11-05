# ResolvAI: API em Node.js

API do ResolvAI migrada de [Resolvai_Backend](https://github.com/danilomarley/Resolvai_Backend) (C# / ASP.NET Core), com Fastify/TypeScript e o mesmo banco no Supabase. Inclui cadastro e perfil profissional; a alteração de senha exige autenticação.

**Stack:** Node.js 22.12+, TypeScript, [Fastify](https://fastify.dev), [zod](https://zod.dev) (validação e OpenAPI), [pg](https://node-postgres.com) (SQL escrito à mão, como o Dapper), [jose](https://github.com/panva/jose) (JWT do Supabase) e [Vitest](https://vitest.dev).

## Como rodar

```bash
npm install
cp .env.example .env   # preencha com os dados do Supabase
npm run dev            # http://localhost:5172/swagger
```

| Comando | O que faz |
| --- | --- |
| `npm run dev` | Sobe a API com recarga automática (lê o `.env`) |
| `npm run build` | Compila para `dist/` |
| `npm start` | Roda a versão compilada |
| `npm test` | Testes de serviço, HTTP e integração com PostgreSQL em memória |
| `npm run typecheck` | Checagem de tipos do TypeScript |

A porta padrão é a mesma da API C# (`5172`), e o proxy do Vite no front já aponta para ela.

## Configuração

Todas as variáveis estão em [.env.example](.env.example). A API valida tudo na inicialização e não sobe se faltar algo, como o `ValidateOnStart` da versão C#.

| Variável | Equivalente na API C# |
| --- | --- |
| `DATABASE_URL` | `Database:ConnectionString`, no formato URL (`postgresql://usuario:senha@host:5432/postgres`) |
| `DATABASE_SSL` | `SSL Mode=Require;Trust Server Certificate=true` |
| `DATABASE_COMMAND_TIMEOUT_SECONDS` | `Database:CommandTimeoutSeconds` |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `SUPABASE_AUDIENCE` | Seção `Supabase` |
| `CORS_ALLOWED_ORIGINS` | `Cors:AllowedOrigins`, separado por vírgula |
| `SUPABASE_STORAGE_BUCKET` | Novo: bucket das fotos dos pedidos (padrão `pedidos`) |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Novo: chat de IA da criação de pedido; opcional |

O repositório é público: **nunca versione o `.env`** (ele já está no `.gitignore`). Em produção, configure as variáveis no provedor de deploy.

## Estrutura

A organização segue as camadas da API C#, com o mesmo sentido de dependências (Api → Application/Infrastructure → Domain).

```
src/
├── domain/            entidades e regras (User, Email, Endereco, Contato, enums)
├── application/
│   ├── contracts.ts   interfaces de repositórios, consultas e Supabase Auth
│   ├── dtos/          schemas zod de entrada e saída (DataAnnotations da versão C#)
│   ├── services/      AuthService, UserService, PedidoService
│   └── mappings/      User → UserResponse
├── infrastructure/
│   ├── database.ts    pool do pg e transações
│   ├── repositories/  UserRepository, EnderecoRepository, ContatoRepository, PedidoRepository, PedidoQueries
│   └── security/      SupabaseAuthClient
├── api/
│   ├── app.ts         Fastify, CORS, Swagger e registro das rotas
│   ├── authentication.ts  validação do JWT e papel do perfil local
│   ├── problem-details.ts erros no formato ProblemDetails
│   └── routes/        auth, users, pedidos (/orders), home
├── composicao.ts      liga as dependências
└── server.ts          inicialização
db/scripts/            scripts SQL do banco (os mesmos da API C#)
tests/                 Vitest
```

## Rotas

| Método | Rota | Acesso |
| --- | --- | --- |
| POST | `/api/v1/auth/login` | público |
| POST | `/api/v1/auth/register` | público |
| POST | `/api/v1/auth/register-provider` | público, cadastro PF/PJ |
| POST | `/api/v1/auth/login-provider` | público, exige Prestador ativo com perfil |
| POST | `/api/v1/auth/refresh` | refresh token, revalida perfil local ativo |
| POST | `/api/v1/auth/check-email` | público, resposta uniforme sem revelar existência da conta |
| POST | `/api/v1/auth/reset-password` | Bearer, altera somente a senha do dono do token |
| GET | `/api/v1/especialidades` | público, catálogo ativo |
| GET | `/api/v1/fornecedores/me` | Prestador ativo, próprio perfil |
| PATCH | `/api/v1/fornecedores/me` | Prestador ativo, próprio perfil |
| GET | `/api/v1/users/me` | autenticado |
| POST | `/api/v1/users/me/complete-registration` | Cliente autenticado |
| GET | `/api/v1/users/me/profile` | autenticado (#61) |
| PATCH | `/api/v1/users/me/profile` | autenticado (#61); Prestador usa `/fornecedores/me` |
| GET | `/api/v1/users` | Admin |
| GET | `/api/v1/users/{id}` | Admin |
| POST | `/api/v1/users` | Admin |
| PATCH | `/api/v1/users/{id}/status` | Admin |
| GET | `/api/v1/orders` | autenticado |
| POST | `/api/v1/orders` | autenticado (Cliente com cadastro finalizado) |
| GET | `/api/v1/orders/{id}` | autenticado |
| POST | `/api/v1/orders/photos` | autenticado, multipart (Cliente com cadastro finalizado, #67) |
| POST | `/api/v1/orders/assistant` | autenticado (chat com IA, #69) |
| GET | `/api/v1/home/summary` | autenticado |

Detalhes de pedidos e da Home em [docs/PEDIDOS-E-HOME.md](docs/PEDIDOS-E-HOME.md). Exemplos de requisição em [requests.http](requests.http). O que mudou em relação à API C# está em [docs/MIGRACAO.md](docs/MIGRACAO.md). O deploy no Render está em [docs/DEPLOY.md](docs/DEPLOY.md).

`reset-password` recebe `{ "newPassword": "..." }` com Bearer verificado e altera somente a senha do sujeito do token. Um campo `email` legado é ignorado. `check-email` sempre devolve a mesma mensagem para e-mails válidos e não envia e-mail. A recuperação de acesso deve usar o fluxo verificado do Supabase Auth. Limites de tentativas são aplicados por IP e, no reset, por UUID.

Contratos, retomada de cadastro, regras PF/PJ e referências SQL em [docs/PROVIDER-REGISTRATION.md](docs/PROVIDER-REGISTRATION.md). Os scripts `013` a `015` documentam tabelas e constraints já existentes no Supabase; não são executados na inicialização nem devem ser reaplicados no banco remoto.

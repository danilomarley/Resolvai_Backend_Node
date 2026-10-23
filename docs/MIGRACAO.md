# Migração da API C# para Node.js

Esta API substitui [Resolvai_Backend](https://github.com/danilomarley/Resolvai_Backend) mantendo rotas, contrato JSON, regras de negócio e banco. O front não precisa de alterações: basta a API Node estar no endereço que ele usa (por padrão, `http://localhost:5172` pelo proxy do Vite).

## Equivalência

| API C# | API Node |
| --- | --- |
| Controllers (`AuthController`, `UsersController`, `PedidosController`, `HomeController`) | `src/api/routes/*-routes.ts` |
| `ApiControllerBase` com `[Authorize]` | Escopo protegido em `src/api/app.ts` (todas as rotas, exceto login e cadastro) |
| `[Authorize(Roles = "Admin")]` | `exigirAdmin` em `src/api/authentication.ts` |
| `AuthenticationExtensions` (JwtBearer + JWKS + HS256 + perfil local) | `criarVerificadorDeToken` e `criarHookDeAutenticacao` |
| `GlobalExceptionHandler` + `AddProblemDetails` | `src/api/problem-details.ts` |
| DataAnnotations dos DTOs | Schemas zod em `src/application/dtos` |
| Services (`AuthService`, `UserService`, `PedidoService`) | `src/application/services` (mesmos nomes e regras) |
| Entidades e value objects (`User`, `Email`, `Endereco`, `Contato`) | `src/domain` |
| Dapper + `NpgsqlConnectionFactory` | `pg` + `src/infrastructure/database.ts` (mesmo SQL) |
| `SupabaseAuthClient` (HttpClient) | `src/infrastructure/security/supabase-auth-client.ts` (fetch) |
| `appsettings` + user-secrets | `.env` (ver `.env.example`) |
| `Resolvai.Application.Checks` | `tests/servicos.test.ts` |
| `Resolvai.Api.http` | `requests.http` |

As mensagens de `detail` que o front interpreta foram mantidas exatamente iguais, por exemplo `Usuário inativo.`, `Cadastro já finalizado.`, `Já existe um usuário com o CPF '...'` e `Finalize o cadastro antes de criar um pedido.`.

## Validação contra a API C#

As duas APIs foram executadas lado a lado sobre o mesmo banco do Supabase, e as respostas das rotas de leitura foram comparadas para cada usuário cadastrado:
- `users/me`, `home/summary`, lista com filtros e paginação e detalhe de cada pedido;
- erros 401, 403, 404 e 400.

Status, headers (`Content-Type`, `Cache-Control`, `Pragma`) e corpos ficaram iguais, com datas comparadas por instante. A única diferença está no texto das mensagens de validação (ver abaixo).

As rotas de escrita (cadastro, finalização de cadastro, criação de pedido, ativação de usuário) não foram exercitadas no Supabase para não criar dados reais. Elas são cobertas pelos testes de integração, que rodam os mesmos scripts SQL num PostgreSQL em memória.

## Diferenças conhecidas

| Ponto | API C# | API Node | Impacto no front |
| --- | --- | --- | --- |
| Mensagens de validação (400) | Textos padrão do .NET, em inglês | Textos em português | Nenhum: o front não lê `errors` |
| Chaves de `errors` em JSON malformado | `$`, `$.campo` e `request` | `$` ou o caminho do campo | Nenhum |
| Precisão das datas | Até 7 casas decimais nos segundos | Milissegundos | Nenhum: o front usa `Date.parse` |
| Decimais | `1100.50` | `1100.5` | Nenhum: mesmo número |
| `status` numérico na query (`?status=1`) | Aceito | Recusado com 400 | Nenhum: o front envia o nome |
| Redirecionamento para HTTPS | `UseHttpsRedirection` | Não faz; fica a cargo do proxy do provedor de deploy | Nenhum |

## Pendências fora desta migração

1. **Índice da listagem:** o script `db/scripts/011_create_ix_pedidos_cliente_criacao.sql` ainda não foi aplicado no Supabase. As consultas funcionam sem ele, mas ficam mais lentas com muitos pedidos.
2. **Credenciais expostas:** o `appsettings.Development.json` do repositório C#, que é público, contém a senha do banco e as chaves do Supabase. Elas devem ser trocadas no painel do Supabase, e o novo valor deve ficar só no `.env` e no provedor de deploy.
3. **Deploy:** configurar o deploy da API Node e apontar o front para ela ([Resolvai_Cliente#65](https://github.com/danilomarley/Resolvai_Cliente/issues/65)).

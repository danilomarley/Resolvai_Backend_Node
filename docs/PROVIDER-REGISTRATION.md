# Cadastro e perfil profissional

O módulo usa o Fastify/TypeScript/pg existente. A conexão continua configurada por `DATABASE_URL`, `DATABASE_SSL` e `DATABASE_COMMAND_TIMEOUT_SECONDS`. Supabase Auth continua usando as variáveis `SUPABASE_*` de `.env.example`; nenhuma credencial nova é necessária. Senhas ficam no Auth. A chave de serviço e a conexão SQL ficam exclusivamente no backend.

## Contratos

| Método | Rota | Acesso e resposta |
| --- | --- | --- |
| POST | `/api/v1/auth/register-provider` | Público; 201 com perfil e `Location: /api/v1/fornecedores/me` |
| POST | `/api/v1/auth/login-provider` | Email/password; 200 com `LoginResponse` existente após validar Prestador ativo e perfil profissional |
| POST | `/api/v1/auth/refresh` | `{ "refreshToken": "..." }`; 200 com `LoginResponse`, incluindo o novo refresh token quando devolvido pelo Auth |
| GET | `/api/v1/especialidades` | Público; lista ativa de `{ "codigo": "...", "nome": "..." }` |
| GET | `/api/v1/fornecedores/me` | Bearer de Prestador ativo; 200 com o próprio perfil |
| PATCH | `/api/v1/fornecedores/me` | Bearer de Prestador ativo; 200 com os dados persistidos |

Login e refresh usam exclusivamente o UUID devolvido pelo Auth para encontrar o perfil local. O papel vem de `users.role`, nunca de metadados editáveis ou da simples igualdade de e-mail. GET/PATCH não aceitam UUID de outro usuário na URL ou no corpo.

O cadastro profissional mantém os campos do C#:

| Campo | Regra |
| --- | --- |
| `name`, `email`, `password` | Obrigatórios; limites de 200, 320 e 8–128 caracteres |
| `tipoPessoa` | `PF` ou `PJ` |
| `nomeExibicao` | Obrigatório; até 200 caracteres |
| `cpf` | PF: CPF válido, com dígitos verificadores; PJ: ausente ou nulo |
| `cnpj` | PJ: CNPJ válido numérico ou alfanumérico; PF: ausente ou nulo |
| `telefone` | DDD e 10 ou 11 dígitos; aceita pontuação usual, persiste somente dígitos |
| `cidadeAtuacao`, `ufAtuacao` | Cidade obrigatória até 120 caracteres; UF brasileira, normalizada para maiúsculas |
| `raioAtendimentoKm` | Inteiro de 1 a 200; padrão 20 no cadastro |
| `bio`, `registroProfissional` | Opcionais, aceitam nulo; até 360 e 80 caracteres |
| `especialidades` | De 1 a 100 códigos existentes e ativos; remove repetições e ordena |

Contas Cliente e Prestador usam e-mails e UUIDs distintos. O mesmo CPF pode existir em papéis diferentes; dentro do papel Prestador ele é único. CNPJ também é único. PJ mantém `users.cpf` nulo.

O PATCH recebe o conjunto completo de campos editáveis: `name`, `nomeExibicao`, `telefone`, `cidadeAtuacao`, `ufAtuacao`, `raioAtendimentoKm` e `especialidades`; `bio` e `registroProfissional` podem ser nulos ou omitidos para limpar. Campos extras, incluindo `email`, `tipoPessoa`, `cpf` e `cnpj`, são rejeitados com 400. A rota genérica de finalização de cadastro é exclusiva de Cliente; Prestador também deve editar seu perfil pela rota profissional.

POST, GET e PATCH retornam os campos profissionais do C#: `idUsuario`, `tipoPessoa`, `nomeExibicao`, `cnpj`, `bio`, `cidadeAtuacao`, `ufAtuacao`, `raioAtendimentoKm`, `registroProfissional`, `especialidades`, `createdAt` e `updatedAt`. A resposta acrescenta `name`, `email`, `cpf` opcional e `telefone`. CPF nulo é omitido; os campos profissionais opcionais são retornados como nulos. Não há senha ou token na resposta de cadastro/perfil. Respostas de perfil e sessão usam `Cache-Control: no-store`.

## Persistência e retomada

Cadastro insere `users`, `fornecedores`, `contatos` e `fornecedor_especialidades` em uma transação PostgreSQL. Edição altera nome, dados profissionais, contato principal e vínculos na mesma transação, preservando e-mail, papel, tipo e documentos. O repositório revalida as especialidades com `FOR SHARE` antes de gravar e bloqueia o usuário durante a edição. Constraints únicas protegem contra corridas e viram 409.

Auth e PostgreSQL não compartilham uma transação distribuída. Se o Auth criar a conta e uma gravação local falhar, a resposta é 503 com orientação para confirmar o e-mail e repetir os mesmos dados e credenciais. A conta externa não é apagada nem tem a senha redefinida. Se o perfil local já foi gravado e somente a resposta se perdeu, uma repetição recebe 409; o usuário pode tentar o login.

O cadastro consulta `GET /auth/v1/settings` no mesmo projeto a cada tentativa e exige valores booleanos válidos para `disable_signup`, `external.email` e `mailer_autoconfirm`. Cadastro ou provedor de e-mail desabilitado impede a criação; falha ou resposta incompleta dos settings impede prosseguir. A chave de serviço é usada somente no servidor para `POST /auth/v1/admin/users`, que cria se o endereço for novo e rejeita duplicados. O corpo limita-se a e-mail, senha, nome e `email_confirm` derivado da política do projeto; não aceita papel ou confirmação escolhidos pelo cliente.

Quando o projeto já usa autoconfirmação, a conta nova é criada confirmada. Quando exige confirmação, a conta é criada pendente e `POST /auth/v1/resend` com `type:"signup"` envia o e-mail sem senha. Falha de envio retorna 503 e deixa a conta intacta para retomada. O cadastro não chama o signup público com senha, porque esse endpoint pode substituir a senha de uma conta pendente antes de confirmar posse, conforme a [implementação oficial de signup](https://github.com/supabase/auth/blob/master/internal/api/signup.go). A criação administrativa rejeita endereço já existente e não envia e-mail, conforme a [implementação oficial de criação](https://github.com/supabase/auth/blob/master/internal/api/admin.go).

Para duplicidade, corrida, resposta perdida ou resultado desconhecido, somente autenticação bem-sucedida com a senha enviada permite adotar o UUID. Uma conta pendente conserva sua senha e exige confirmação, mesmo se a política do projeto passou a autoconfirmar novos cadastros. Reenvio de confirmação não modifica a senha. O provisionamento administrativo existente continua separado e mantém seu comportamento explícito de criação confirmada.

As rotas públicas de cadastro Cliente e Prestador têm limite de 10 tentativas por IP a cada 15 minutos por rota/instância, inclusive corpos inválidos. Não há endpoint público que encaminhe campos administrativos arbitrários. O envio de confirmação e a política consultada seguem os endpoints oficiais [settings](https://github.com/supabase/auth/blob/master/internal/api/settings.go) e [resend](https://github.com/supabase/auth/blob/master/internal/api/resend.go).

## Erros e senha

400: campos/documentos/especialidades inválidos ou rejeição explícita da senha. 401: Bearer inválido, UUID sem perfil local ou conta inativa. 403: outro papel tentando acesso profissional ou cadastro por e-mail desabilitado no projeto. 404: Prestador sem perfil profissional. 409: duplicidade ou retomada sem prova de posse. 429: limite de tentativas. 503: indisponibilidade do Auth/settings/confirmação ou cadastro cuja conclusão não pôde ser confirmada. Falhas locais inesperadas na edição retornam erro genérico 500 e fazem rollback; detalhes do driver não vão para a resposta.

`POST /auth/reset-password` exige Bearer e recebe somente `newPassword`, com 8–128 caracteres. O backend altera a senha do UUID verificado; o campo `email` legado não escolhe o alvo. `POST /auth/check-email` não consulta a existência da conta e não envia e-mail: devolve uma mensagem uniforme. Recuperação de acesso precisa do fluxo verificado do Supabase Auth, configurado separadamente. Limites em memória continuam por instância.

## Banco existente e verificação local

As tabelas profissionais e `UNIQUE(cpf, role)` já existem no banco remoto. `013_create_fornecedores.sql`, `014_create_especialidades_fornecedor.sql` e `015_users_cpf_por_papel.sql` são referências versionadas para reconstrução isolada; não devem ser reaplicadas no Supabase existente. O número 012 continua reservado ao bucket de pedidos. Nenhum script é executado automaticamente pela API.

As tabelas profissionais têm RLS e privilégios diretos de `anon`/`authenticated` revogados; a aplicação faz a autorização pelo UUID, papel e conta local ativa antes de usar o repositório SQL do servidor.

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
```

A integração usa PostgreSQL PGlite em memória com os scripts reais e o driver `pg` via socket local. Somente a fronteira externa de Auth é simulada. Os testes cobrem PF/PJ, CNPJ alfanumérico, unicidade por papel, validações, permissões, edição persistida, rollback tardio, retomada, UUID divergente, reset autenticado e refresh. Eles não precisam de `.env`, conta real ou conexão ao Supabase remoto. A execução real ainda depende das variáveis privadas do ambiente, fornecidas fora do Git.

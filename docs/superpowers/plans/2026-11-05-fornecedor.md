# Fornecedor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Track steps with checkboxes.

**Goal:** Corrigir autenticação e integrar cadastro e perfil profissional entre React, Node e Supabase.

**Architecture:** Preservar camadas existentes e migrar regras do C#; API Fastify executa SQL parametrizado e acessa Supabase Auth. Frontend consome somente a API do backend.

**Tech Stack:** React 19, Vite 8, Node >=22.12, TypeScript, Fastify, pg, zod, Vitest/PGlite; testes frontend com Node test runner.

**Spec:** ../specs/2026-11-05-fornecedor-design.md

## Global Constraints

- Backend `feat/migrar-fornecedor` parte de `main`; frontend `feat/ajustar-cadastro` parte de `dev`.
- Preservar o frontend na raiz e as telas existentes.
- Não implementar documentos, portfólio, oportunidades, propostas ou aprovação manual.
- Sem gravações no Supabase remoto, dados reais, credenciais em commits ou chaves privilegiadas no frontend.
- Senhas no Supabase Auth; autorização por UUID, papel Prestador e perfil local ativo.
- CPF por papel; PF usa CPF válido, PJ usa CNPJ válido e CPF nulo; raio de 1 a 200 km.
- Erros HTTP coerentes e visíveis ao usuário; sucesso apenas depois de persistência confirmada.

## Review Focus

- UUID distinto com mesmo e-mail jamais adota outra identidade.
- Cliente, inativo e Prestador sem perfil não entram na área profissional.
- Falha na última gravação reverte todas as gravações PostgreSQL do cadastro/perfil.
- CPF entre papéis é permitido; CNPJ alfanumérico mantém letras e valida dígitos.
- Sessão expirada, resposta HTTP inválida e falha de rede não deixam sucesso falso nem loop de navegação.

## Task 1: Autenticação e API profissional

**Files:** `src/application/contracts.ts`, `src/application/dtos/{auth,fornecedores}.ts`, serviços de auth/user/fornecedor/especialidades, domínio fornecedor/documentos/telefone, repositórios fornecedor/especialidades/users, cliente Supabase Auth, rotas, composição, testes e documentação do backend. Usar arquivos focados seguindo os padrões atuais.

**Interfaces:**
- `POST /api/v1/auth/register-provider`: corpo do C# RegisterFornecedorRequest; 201 com FornecedorResponse.
- `POST /api/v1/auth/login-provider`: email/password; LoginResponse existente após validar Prestador ativo e perfil.
- `POST /api/v1/auth/refresh`: refreshToken; LoginResponse existente, identidade estrita e conta ativa.
- `GET /api/v1/especialidades`: público, lista `{codigo,nome}` ativa.
- `GET /api/v1/fornecedores/me`: Bearer Prestador, FornecedorResponse do C# acrescido de `name`, `email`, `cpf` opcional e `telefone`.
- `PATCH /api/v1/fornecedores/me`: dados editáveis completos (`name,nomeExibicao,telefone,cidadeAtuacao,ufAtuacao,raioAtendimentoKm,bio,registroProfissional,especialidades`); não alterar email/tipo/documentos; mesma resposta de GET.
- Corrigir reset-password para exigir Bearer e alterar somente a senha do dono do token; não aceitar email como autorização. Preservar operações Cliente seguras; check-email não deve permitir enumeração pública.

- [x] Escrever testes de regressão e observar falha para UUID divergente, reset anônimo e CPF por papel.
- [x] Implementar correções mínimas de autenticação antes do módulo profissional.
- [x] Escrever testes de cadastro PF/PJ, especialidades, 401/403/404, rollback, duplicidade, retomada e PATCH persistido; observar falhas.
- [x] Migrar regras e repositório transacional do C#, adicionar edição profissional e registrar as rotas na composição.
- [x] Executar suite completa, typecheck e build. Testar SQL em PGlite sem rede externa.
- [x] Documentar endpoints/configuração e referências SQL, criar commits locais e relatório com evidência RED/GREEN.

## Task 2: Frontend cadastro/login/perfil

**Files:** `src/services/{api,auth,fornecedores,serviceCategories}.js`, sessão/contexto, `LoginForm.jsx`, `RegisterPage.jsx`, `ProviderProfilePage.jsx`, sidebar, App e CSS estritamente necessário, `.env.example`, README e testes frontend.

**Consumes:** Contratos da Task 1. Nome de base público `VITE_API_BASE_URL`; padrão `/api` via proxy Vite para `http://127.0.0.1:5172` (serviços usam paths `/api/v1/...` com base padrão vazia).

**Produces:** Cadastro PF/PJ real, login profissional com renovação de sessão, conta/menu com identidade real e perfil lido/salvo na API.

- [ ] Escrever testes comportamentais dos serviços e sessão (payloads PF/PJ, erros, 401, expiração, refresh e persistência), observar falhas.
- [ ] Criar cliente HTTP, sessão e serviços com formatos da Task 1, sem senhas armazenadas.
- [ ] Integrar cadastro sem upload/portfólio/aprovação, com senha, tipo de pessoa, documentos, cidade/UF/raio, especialidades reais, nome de exibição e opcionais profissionais.
- [ ] Integrar login assíncrono com erros/carregamento, Lembrar acesso, navegação protegida e sair; usar identidade real no menu/saudação.
- [ ] Carregar perfil real, salvar alterações permitidas, manter documentos/e-mail somente leitura; remover portfólio e métricas fictícias dessa tela sem implementar recursos novos.
- [ ] Executar testes completos do frontend, lint e build; criar commits locais e relatório RED/GREEN.

## Final verification

- [ ] Revisões de tarefa e revisão integrada dos dois repositórios.
- [ ] Confirmar branches/bases, frontend na raiz, ausência de mudanças remotas e exclusões de escopo.
- [ ] Smoke test HTTP/UI local e registrar limitações de configuração real do backend.

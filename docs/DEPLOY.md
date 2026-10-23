# Deploy no Render (#65)

A API e o front sobem no [Render](https://render.com), cada um a partir do `render.yaml` do próprio repositório. O deploy é automático a cada push na `main`, depois que o CI do GitHub passa.

| | API (este repositório) | Front (Resolvai_Cliente) |
| --- | --- | --- |
| Tipo | Web Service (Node) | Static Site |
| Plano | Free: hiberna após ~15 min sem uso; a primeira requisição depois disso leva de 30 a 60 s | Free, servido por CDN, sem hibernação |
| Região | Oregon (mesma do Supabase, `us-west-2`) | CDN global |
| Health check | `GET /health` | não se aplica |

## 1. Banco

Antes do primeiro deploy, aplique no SQL Editor do Supabase os scripts de `db/scripts` que ainda não rodaram. Hoje faltam:

- `011_create_ix_pedidos_cliente_criacao.sql` (índice da listagem de pedidos);
- `012_create_bucket_pedidos.sql` (bucket das fotos; sem ele, `POST /api/v1/orders/photos` falha).

## 2. API

1. No Render, **New > Blueprint** e selecione o repositório `Resolvai_Backend_Node`. O Render lê o `render.yaml` e cria o serviço `resolvai-api`.
2. Preencha as variáveis marcadas como secretas (os mesmos valores do `.env` local):
   `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `ANTHROPIC_API_KEY` e `CORS_ALLOWED_ORIGINS`.
3. Em `CORS_ALLOWED_ORIGINS`, use a URL do front no Render (ex.: `https://resolvai-front.onrender.com`). Se o front ainda não existir, deixe vazio e atualize depois.
4. Depois do deploy, confira `https://<api>.onrender.com/health` e `https://<api>.onrender.com/swagger`.

## 3. Front

1. No Render, **New > Blueprint** e selecione `Resolvai_Cliente`. O `render.yaml` dele cria o Static Site `resolvai-front`.
2. Preencha `VITE_API_BASE_URL` com a URL da API (ex.: `https://resolvai-api.onrender.com`). A variável é lida no build: ao mudá-la, rode um novo deploy do front.
3. Volte à API e coloque a URL do front em `CORS_ALLOWED_ORIGINS`.

## Observações

- `ANTHROPIC_API_KEY` é opcional. Sem ela, só o chat de criação de pedido responde 503.
- O limite de tentativas (recuperação de senha, chat e fotos) fica em memória e vale por instância, o que basta para uma instância no plano Free.
- Para não hibernar, é preciso um plano pago do Render.

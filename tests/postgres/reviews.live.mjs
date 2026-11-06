import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import pg from 'pg'
import { SignJWT } from 'jose'
import { buildApp } from '../../dist/api/app.js'
import { criarDependencias } from '../../dist/composicao.js'
import { loadConfig } from '../../dist/config/env.js'
import { createDatabase } from '../../dist/infrastructure/database.js'

// PostgreSQL real do ambiente E2E descartável. Nenhuma URL herdada é usada.
const url = 'postgresql://postgres:local-e2e-only@127.0.0.1:55432/resolvai_e2e'
const secret = 'local-e2e-only-never-use-in-production-2026'
const pool = new pg.Pool({ connectionString: url, max: 4 })
const ids = { customer: randomUUID(), stranger: randomUUID(), provider: randomUUID() }
const config = loadConfig({ DATABASE_URL: url, DATABASE_SSL: 'false', SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_ANON_KEY: 'test-public', SUPABASE_SERVICE_ROLE_KEY: 'test-private', SUPABASE_JWT_SECRET: secret })
const database = createDatabase(config.database)
let app, origin, barrier, release, race = false
const pids = new Set()
const instrumented = { ...database, transaction: (callback, isolation) => database.transaction(async sql => {
  if (race) {
    const [row] = await sql.query('select pg_backend_pid() as pid')
    pids.add(row.pid)
    if (pids.size === 2) release()
    await Promise.race([barrier, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Two PostgreSQL connections did not overlap')), 5000); timer.unref() })])
  }
  return callback(sql)
}, isolation) }
async function guard() {
  const result = await pool.query('select current_database() as name, marker from e2e_guard')
  assert.deepEqual(result.rows, [{ name: 'resolvai_e2e', marker: 'resolvai-sprint4-ephemeral-only' }])
}
async function order(status = 'concluido', chosen = true) {
  const id = randomUUID()
  await pool.query('insert into pedidos (id,id_cliente,status) values ($1,$2,$3)', [id, ids.customer, status])
  if (chosen) await pool.query("insert into propostas (id_pedido,id_prestador,status,valor) values ($1,$2,'escolhida',100)", [id, ids.provider])
  return id
}
async function request(method, path, user = ids.customer, body) {
  const token = user && await new SignJWT({ email: 'customer@e2e.example.test', role: 'authenticated' }).setProtectedHeader({ alg: 'HS256' }).setSubject(user).setIssuer(`${config.supabase.url}/auth/v1`).setAudience('authenticated').setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode(secret))
  return fetch(`${origin}${path}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
}
before(async () => {
  await guard()
  const migrations = fileURLToPath(new URL('../../db/scripts/', import.meta.url))
  for (const file of readdirSync(migrations).filter(n => n.endsWith('.sql')).sort()) await pool.query(readFileSync(join(migrations, file), 'utf8'))
  for (const [role, id] of Object.entries(ids)) await pool.query('insert into users (id,name,email,role) values ($1,$2,$3,$4)', [id, `Review ${role}`, `${id}@e2e.example.test`, role === 'provider' ? 'Prestador' : 'Cliente'])
  app = await buildApp({ dependencias: criarDependencias(config, instrumented) })
  origin = await app.listen({ port: 0, host: '127.0.0.1' })
})
after(async () => {
  race = false
  await app?.close()
  await guard()
  await pool.query('delete from avaliacoes where id_cliente=$1', [ids.customer])
  await pool.query('delete from pedidos where id_cliente=$1', [ids.customer])
  await pool.query('delete from users where id=any($1::uuid[])', [Object.values(ids)])
  await database.close(); await pool.end()
})

test('two real HTTP requests overlap on independent PostgreSQL connections and persist one review', async () => {
  const id = await order()
  barrier = new Promise(resolve => { release = resolve })
  race = true
  const results = await Promise.all([1, 2].map(() => request('POST', `/api/v1/orders/${id}/review`, ids.customer, { rating: 4, comment: '  Serviço real de teste  ' })))
  race = false
  assert.deepEqual(results.map(r => r.status).sort(), [201, 409])
  assert.equal(pids.size, 2, 'distinct pg_backend_pid proves independent overlapping transactions')
  const result = await pool.query('select id_prestador,nota,comentario from avaliacoes where id_pedido=$1', [id])
  assert.deepEqual(result.rows, [{ id_prestador: ids.provider, nota: 4, comentario: 'Serviço real de teste' }])
  console.log('PostgreSQL real: two independent connection IDs; one persisted review; HTTP 201/409.')
})

test('authentication, ownership, all non-completed states and unidentified providers are rejected', async () => {
  const id = await order()
  assert.equal((await request('POST', `/api/v1/orders/${id}/review`, null, { rating: 5 })).status, 401)
  assert.equal((await request('POST', `/api/v1/orders/${id}/review`, ids.stranger, { rating: 5 })).status, 404)
  for (const status of ['aberto', 'em_andamento', 'cancelado']) {
    const current = await order(status)
    assert.equal((await request('POST', `/api/v1/orders/${current}/review`, ids.customer, { rating: 5 })).status, 400)
  }
  const absent = await order('concluido', false)
  assert.equal((await request('POST', `/api/v1/orders/${absent}/review`, ids.customer, { rating: 5 })).status, 409)
  assert.equal((await request('POST', `/api/v1/orders/${id}/review`, ids.customer, { rating: 5, providerId: ids.stranger })).status, 400)
})

test('database constraints enforce bounds, comment length, references and uniqueness', async () => {
  const id = await order()
  const insert = (orderId, score, comment = null) => pool.query('insert into avaliacoes (id_pedido,id_cliente,id_prestador,nota,comentario) values ($1,$2,$3,$4,$5)', [orderId, ids.customer, ids.provider, score, comment])
  await assert.rejects(insert(id, 0), { code: '23514' })
  await assert.rejects(insert(id, 6), { code: '23514' })
  await assert.rejects(insert(id, 5, 'x'.repeat(2001)), { code: '23514' })
  await assert.rejects(insert(randomUUID(), 5), { code: '23503' })
  await insert(id, 1)
  await assert.rejects(insert(id, 5), { code: '23505' })
})

test('RLS denies direct reads/writes even after table privileges are granted to a non-owner', async () => {
  await guard()
  await pool.query('create role reviews_test_reader nologin')
  await pool.query('grant usage on schema public to reviews_test_reader')
  await pool.query('grant select,insert on avaliacoes to reviews_test_reader')
  const client = await pool.connect()
  try {
    await client.query('begin'); await client.query('set local role reviews_test_reader')
    assert.equal((await client.query('select * from public.avaliacoes')).rowCount, 0)
    await client.query('rollback')
    await client.query('begin'); await client.query('set local role reviews_test_reader')
    await assert.rejects(client.query('insert into avaliacoes (id_pedido,id_cliente,id_prestador,nota) values ($1,$2,$3,5)', [randomUUID(), ids.customer, ids.provider]), { code: '42501' })
    await client.query('rollback')
  } finally { client.release() }
})

test('real HTTP reads, summary and OpenAPI match persisted reviews and keep client data private', async () => {
  const id = await order()
  const response = await request('POST', `/api/v1/orders/${id}/review`, ids.customer, { rating: 5 })
  assert.equal(response.status, 201)
  const review = await response.json()
  assert.equal(review.providerId, ids.provider)
  assert.equal(review.comment, undefined)
  assert.equal(review.email, undefined)
  const read = await request('GET', `/api/v1/orders/${id}/review`)
  assert.deepEqual(await read.json(), review)
  const summary = await (await request('GET', '/api/v1/users/me/reviews/summary')).json()
  assert.ok(summary.count >= 1 && summary.averageRating >= 1 && summary.averageRating <= 5)
  const spec = await (await fetch(`${origin}/openapi/v1.json`)).json()
  assert.deepEqual(spec.paths['/api/v1/orders/{id}/review'].post.security, [{ Bearer: [] }])
})

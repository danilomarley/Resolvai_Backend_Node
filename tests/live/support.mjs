import { createHmac, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import pg from 'pg'

export const root = fileURLToPath(new URL('../../', import.meta.url))
export const api = 'http://127.0.0.1:5175'
export const auth = 'http://127.0.0.1:54322'
export const secret = 'isolated-password-security-test-only-secret-2026'
export const db = new pg.Pool({ connectionString: 'postgresql://postgres:isolated-test-only@127.0.0.1:55433/resolvai_security_test', max: 4 })
export function key(role) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
  const data = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ role, iss: 'supabase', exp: Math.floor(Date.now() / 1000) + 3600 })}`
  return `${data}.${createHmac('sha256', secret).update(data).digest('base64url')}`
}
export async function guard() {
  const result = await db.query('select current_database() as name, marker from test_guard')
  assert.deepEqual(result.rows, [{ name: 'resolvai_security_test', marker: 'password-security-ephemeral' }])
}
export async function prepare() {
  await guard()
  const existing = await db.query("select to_regclass('public.users') as name")
  if (!existing.rows[0].name) for (const name of readdirSync(join(root, 'db/scripts')).filter(n => n.endsWith('.sql')).sort()) await db.query(readFileSync(join(root, 'db/scripts', name), 'utf8'))
}
export async function start(directory = root, port = 5175) {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(DATABASE_|SUPABASE_|ANTHROPIC_|NODE_OPTIONS$)/.test(name)))
  const child = spawn(process.execPath, [join(directory, 'dist/server.js')], { cwd: directory, stdio: ['ignore', 'ignore', 'inherit'], windowsHide: true,
    env: { ...clean, HOST: '127.0.0.1', PORT: String(port), LOG_LEVEL: 'error', DATABASE_URL: 'postgresql://postgres:isolated-test-only@127.0.0.1:55433/resolvai_security_test', DATABASE_SSL: 'false',
      SUPABASE_URL: auth, SUPABASE_ANON_KEY: key('anon'), SUPABASE_SERVICE_ROLE_KEY: key('service_role'), SUPABASE_JWT_SECRET: secret } })
  await poll(async () => { const response = await fetch(`http://127.0.0.1:${port}/health`); return response.ok })
  return child
}
export async function poll(check, timeout = 20000) {
  const until = Date.now() + timeout
  while (Date.now() < until) {
    try { const value = await check(); if (value) return value } catch { /* Serviço ainda iniciando. */ }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('Serviço isolado não ficou disponível no prazo.')
}
export async function call(path, data, origin = api) {
  return fetch(`${origin}/api/v1${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
}
export async function account(origin = api) {
  const value = { name: 'Security Test', email: `${randomUUID()}@e2e.example.test`, password: `Test!${randomUUID()}` }
  const response = await call('/auth/register', value, origin)
  assert.equal(response.status, 201, 'isolated account registered')
  return { ...value, id: (await response.json()).id }
}
export async function cleanup(value) {
  await guard()
  await db.query('delete from public.users where id=$1 and email=$2', [value.id, value.email])
  const response = await fetch(`${auth}/auth/v1/admin/users/${value.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${key('service_role')}`, apikey: key('service_role') } })
  assert.equal(response.ok, true, 'isolated auth account removed')
}
export async function code(email) {
  return poll(async () => {
    const messages = await (await fetch('http://127.0.0.1:8026/api/v1/messages')).json()
    const message = messages.messages.find(m => m.To.some(to => to.Address.toLowerCase() === email.toLowerCase()))
    if (!message) return undefined
    const body = await (await fetch(`http://127.0.0.1:8026/api/v1/message/${message.ID}`)).json()
    return (body.Text || body.HTML).match(/\b\d{6}\b/)?.[0]
  })
}

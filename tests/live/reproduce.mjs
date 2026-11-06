import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { account, call, cleanup, db, prepare, start } from './support.mjs'

// Exige cópia isolada do SHA vulnerável; nunca aceita URL de aplicação externa.
if (!process.argv[2]) throw new Error('Informe o diretório da baseline isolada.')
await prepare()
const child = await start(resolve(process.argv[2]), 5176)
const origin = 'http://127.0.0.1:5176'
let value
try {
  value = await account(origin)
  const password = `Changed!${value.password}`
  assert.equal((await call('/auth/reset-password', { email: value.email, newPassword: password }, origin)).status, 200)
  assert.equal((await call('/auth/login', { email: value.email, password }, origin)).status, 200)
  assert.equal((await call('/auth/login', { email: value.email, password: value.password }, origin)).status, 401)
  console.log('BASELINE CONFIRMED: unauthenticated reset changed password; new login accepted, old password rejected. Synthetic local account only.')
} finally { if (value) await cleanup(value); child.kill('SIGTERM'); await db.end() }

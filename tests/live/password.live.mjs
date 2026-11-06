import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { account, call, cleanup, code, db, guard, prepare, start } from './support.mjs'

let child
before(async () => { await prepare(); child = await start() })
after(async () => { child?.kill('SIGTERM'); await db.end() })

test('missing/invalid OTPs cannot change password, and another account cannot use the code', async () => {
  const a = await account(), b = await account()
  try {
    const newPassword = `New!${a.password}`
    assert.equal((await call('/auth/reset-password', { email: a.email, newPassword })).status, 400)
    assert.equal((await call('/auth/reset-password', { email: a.email, token: '000000', newPassword })).status, 401)
    assert.equal((await call('/auth/login', { email: a.email, password: a.password })).status, 200)
    const requested = await call('/auth/check-email', { email: a.email })
    const absent = await call('/auth/check-email', { email: 'not-registered@e2e.example.test' })
    assert.equal(requested.status, 200); assert.equal(absent.status, 200)
    assert.deepEqual(await requested.json(), await absent.json())
    const token = await code(a.email)
    assert.equal((await call('/auth/reset-password', { email: b.email, token, newPassword })).status, 401)
    assert.equal((await call('/auth/login', { email: b.email, password: b.password })).status, 200)
    assert.equal((await call('/auth/reset-password', { email: a.email, token, newPassword })).status, 200)
    assert.equal((await call('/auth/reset-password', { email: a.email, token, newPassword: `Again!${a.password}` })).status, 401)
    assert.equal((await call('/auth/login', { email: a.email, password: newPassword })).status, 200)
    assert.equal((await call('/auth/login', { email: a.email, password: a.password })).status, 401)
  } finally { await cleanup(a); await cleanup(b) }
})

test('an expired recovery code does not authorize a password change', async () => {
  const a = await account()
  try {
    await call('/auth/check-email', { email: a.email })
    const token = await code(a.email)
    await guard()
    // Fixture temporal somente no GoTrue v2.197.0 local, sem esperar a expiração em tempo real.
    await db.query("update auth.users set recovery_sent_at=now()-interval '2 hours' where id=$1", [a.id])
    assert.equal((await call('/auth/reset-password', { email: a.email, token, newPassword: `New!${a.password}` })).status, 401)
    assert.equal((await call('/auth/login', { email: a.email, password: a.password })).status, 200)
  } finally { await cleanup(a) }
})

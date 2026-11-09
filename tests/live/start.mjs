import { db, prepare, start } from './support.mjs'
await prepare()
const child = await start()
const stop = async () => { child.kill('SIGTERM'); await db.end(); process.exit(0) }
process.once('SIGTERM', stop); process.once('SIGINT', stop)
child.once('exit', code => process.exit(code ?? 1))

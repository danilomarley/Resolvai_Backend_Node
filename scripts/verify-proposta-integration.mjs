import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { loadConfig } from '../dist/config/env.js'
import { createDatabase } from '../dist/infrastructure/database.js'
import { OportunidadeQueries } from '../dist/infrastructure/repositories/oportunidade-queries.js'
import { PropostaFornecedorRepository } from '../dist/infrastructure/repositories/proposta-fornecedor-repository.js'
import { criarPropostaSchema } from '../dist/application/dtos/propostas-fornecedor.js'
import { ConflictException, NotFoundException } from '../dist/application/errors.js'
import { SupabaseStorage } from '../dist/infrastructure/storage/supabase-storage.js'

// Explicit integration check: proposal is always rolled back; only our unique temporary image is deleted.
const config = loadConfig()
const database = createDatabase(config.database)
try {
  const [schema] = await database.query("select count(*) as total from information_schema.columns where table_schema='public' and table_name='propostas' and column_name in ('data_inicio','materiais','garantia_prazo','garantia_tipo','garantia_condicoes','portfolio','payload_hash','data_criacao','prazo_dias')")
  assert.equal(schema.total, 9)
  let eligible
  const providers = await database.query("select f.id_usuario from public.fornecedores f join public.users u on u.id=f.id_usuario where u.is_active=true and u.role='Prestador'")
  for (const provider of providers) {
    for (let pageNumber = 1; ; pageNumber++) {
      const page = await new OportunidadeQueries(database).list(provider.id_usuario, { page: pageNumber, pageSize: 50, search: '', category: '', sort: 'recent' })
      for (const item of page.items) {
        try {
          await new PropostaFornecedorRepository(database).assertAvailable(item.id, provider.id_usuario)
          eligible = { providerId: provider.id_usuario, orderId: item.id }
          break
        } catch (error) {
          if (!(error instanceof ConflictException || error instanceof NotFoundException)) throw error
        }
      }
      if (eligible || pageNumber >= page.totalPages) break
    }
    if (eligible) break
  }
  if (eligible) {
    const data = criarPropostaSchema.parse({ requestId: randomUUID(), valueCents: 1723, deadline: '3 dias', startDate: '2099-01-01', description: 'Verificação transacional temporária, sem publicação.', materials: 'Teste temporário', guaranteePeriod: '90 dias', guaranteeType: 'Reexecução gratuita', guaranteeConditions: 'Teste com rollback' })
    const rollback = new Error('INTENTIONAL_TEST_ROLLBACK')
    try {
      await database.transaction(async sql => {
        const scoped = { ...sql, transaction: async callback => callback(sql), close: async () => {} }
        const repository = new PropostaFornecedorRepository(scoped)
        const result = await repository.create(eligible.orderId, eligible.providerId, data, 'isolated-readback-verification', [])
        assert.equal(result.proposal.value, 17.23)
        assert.equal(result.proposal.materials, data.materials)
        assert.equal(result.proposal.startDate, data.startDate)
        const [persisted] = await sql.query('select prazo_dias from public.propostas where id=$1', [data.requestId])
        assert.equal(persisted.prazo_dias, 3)
        assert.equal((await repository.find(data.requestId)).proposal.warranty.conditions, data.guaranteeConditions)
        throw rollback
      })
    } catch (error) { if (error !== rollback) throw error }
    assert.equal(await new PropostaFornecedorRepository(database).find(data.requestId), null)
    console.log(JSON.stringify({ database: 'write/read verified; rolled back; no test proposal persisted' }))
  } else console.log(JSON.stringify({ database: 'schema verified; no eligible order for transactional check' }))

  const storage = new SupabaseStorage({ url: config.supabase.url, serviceRoleKey: config.supabase.serviceRoleKey, bucket: config.supabase.storageBucket })
  const path = `propostas/_integration_checks/${randomUUID()}.png`
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6wsAAAAASUVORK5CYII=', 'base64')
  try {
    const url = await storage.enviar(path, image, 'image/png')
    const response = await fetch(url)
    assert.equal(response.status, 200)
    assert.ok(Buffer.from(await response.arrayBuffer()).equals(image))
  } finally { await storage.remover([path]) }
  const [remaining] = await database.query('select count(*) as total from storage.objects where bucket_id=$1 and name=$2', [config.supabase.storageBucket, path])
  assert.equal(remaining.total, 0)
  console.log(JSON.stringify({ storage: 'upload and download verified; temporary image removed' }))
} finally { await database.close() }

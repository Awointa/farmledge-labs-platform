/**
 * tests/commodities.test.ts
 *
 * Test suite for the commodity registry (GRADE-1).
 *
 * Coverage:
 *  1. Registry shape — every DB Commodity has an entry, enabled/disabled flags
 *  2. Env key guard — every enabled commodity's contractIdEnvKey is in the env schema
 *  3. Deposit schema via HTTP — INVALID_GRADE, COMMODITY_NOT_ENABLED, UNKNOWN_COMMODITY,
 *     and a passing valid request
 *  4. Config-only extension — FAKE commodity injected via factory only; zero production
 *     code changes needed; disabled FAKE commodity also tested
 *  5. Static guard — no commodity/grade literals in src/controllers/** or src/schemas/**
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import type { Server } from 'node:http'

import { Commodity } from '@prisma/client'

import {
  COMMODITY_REGISTRY,
  createRegistry,
  getCommodityConfig,
  getEnabledCommodities,
  getEnabledCodes,
  isDbCommodity,
  type CommodityEntry,
} from '../src/config/commodities.js'
import { parseEnv, type Env } from '../src/config/env.js'
import { createDepositSchema } from '../src/schemas/custodian.schemas.js'
import app from '../src/app.js'
import { signToken } from '../src/lib/jwt.js'

// ─── HTTP server setup ────────────────────────────────────────────────────────

let server: Server
let baseUrl: string
const jwt = signToken({ sub: 'test-custodian', role: 'custodian' })

const validDeposit = {
  farmerId: 'farmer-1',
  commodity: 'MAIZE_WHITE',
  grade: 'Grade A',
  bagCount: 10,
  weightPerBagKg: 95,
  warehouseId: 'warehouse-1',
}

before(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve())
  })
  const addr = server.address()
  if (addr === null || typeof addr === 'string') {
    throw new Error('Expected a TCP address from app.listen(0)')
  }
  baseUrl = `http://127.0.0.1:${addr.port}`
})

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

// ─── 1. Registry shape ────────────────────────────────────────────────────────

describe('commodity registry — shape', () => {
  test('every Prisma Commodity enum value has a registry entry', () => {
    for (const code of Object.values(Commodity)) {
      const entry = getCommodityConfig(code)
      assert.ok(
        entry !== undefined,
        `Missing COMMODITY_REGISTRY entry for Commodity.${code}`,
      )
    }
  })

  test('MAIZE_WHITE is enabled with correct bag size', () => {
    const entry = getCommodityConfig('MAIZE_WHITE')
    assert.ok(entry !== undefined)
    assert.equal(entry.enabled, true)
    assert.equal(entry.bag.standardKg, 100)
    assert.equal(entry.bag.overrideAllowed, true)
  })

  test('MAIZE_YELLOW is enabled with correct bag size', () => {
    const entry = getCommodityConfig('MAIZE_YELLOW')
    assert.ok(entry !== undefined)
    assert.equal(entry.enabled, true)
    assert.equal(entry.bag.standardKg, 100)
    assert.equal(entry.bag.overrideAllowed, true)
  })

  test('SESAME is enabled with correct bag size', () => {
    const entry = getCommodityConfig('SESAME')
    assert.ok(entry !== undefined)
    assert.equal(entry.enabled, true)
    assert.equal(entry.bag.standardKg, 80)
    assert.equal(entry.bag.overrideAllowed, true)
  })

  test('SORGHUM is registered but disabled', () => {
    const entry = getCommodityConfig('SORGHUM')
    assert.ok(entry !== undefined, 'SORGHUM must be in the registry')
    assert.equal(entry.enabled, false, 'SORGHUM must have enabled: false')
  })

  test('only MAIZE_WHITE, MAIZE_YELLOW, SESAME are enabled', () => {
    const enabledCodes = getEnabledCodes()
    assert.deepEqual(
      [...enabledCodes].sort(),
      ['MAIZE_WHITE', 'MAIZE_YELLOW', 'SESAME'].sort(),
    )
  })

  test('getEnabledCommodities returns only enabled entries', () => {
    const enabled = getEnabledCommodities()
    assert.ok(enabled.every((e) => e.enabled))
    assert.equal(enabled.length, 3)
  })

  test('getCommodityConfig returns undefined for an unknown code', () => {
    assert.equal(getCommodityConfig('BANANA'), undefined)
    assert.equal(getCommodityConfig(''), undefined)
    assert.equal(getCommodityConfig('maize_white'), undefined) // case-sensitive
  })

  test('isDbCommodity returns true for all Prisma Commodity values', () => {
    for (const code of Object.values(Commodity)) {
      assert.equal(isDbCommodity(code), true, `Expected ${code} to be a DB commodity`)
    }
  })

  test('isDbCommodity returns false for SORGHUM and unknown codes', () => {
    assert.equal(isDbCommodity('SORGHUM'), false)
    assert.equal(isDbCommodity('BANANA'), false)
  })

  test('every enabled commodity has non-empty validGrades', () => {
    for (const entry of getEnabledCommodities()) {
      assert.ok(
        entry.validGrades.length > 0,
        `${entry.code} is enabled but has no validGrades`,
      )
    }
  })

  test('every enabled commodity has valid grade wire-format strings', () => {
    const expected = new Set(['Grade A', 'Grade B', 'Grade C'])
    for (const entry of getEnabledCommodities()) {
      for (const grade of entry.validGrades) {
        assert.ok(
          expected.has(grade),
          `${entry.code} has unexpected grade "${grade}"`,
        )
      }
    }
  })
})

// ─── 2. Env key guard ─────────────────────────────────────────────────────────

describe('commodity registry — env key guard', () => {
  test('every enabled commodity contractIdEnvKey exists in the env schema', () => {
    // The Env type is the source of truth for all declared env keys.
    // We create a dummy object typed as Env and check keys from that type.
    // Since TypeScript types are erased at runtime, we use a well-known full
    // env parse to get ALL keys the schema declares (including optional ones).
    // We provide values for every declared optional field so they appear in
    // the parsed output — or we rely on the Env type's compile-time key set.
    //
    // Approach: parse with ALL optional keys supplied as non-empty strings so
    // they appear in the output, then check the key set.
    const fullEnv: NodeJS.ProcessEnv = {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://test',
      DIRECT_URL: 'postgresql://test',
      JWT_SECRET: 'test-secret-that-is-long-enough-32chars',
      PLATFORM_ADMIN_SECRET: 'test-admin-secret',
      LENDER_API_KEY_SALT: 'test-salt-that-is-long-enough-for-validation',
      STELLAR_NETWORK: 'testnet',
      HORIZON_URL: 'https://horizon-testnet.stellar.org',
      STELLAR_PLATFORM_SECRET: 'STEST',
      S3_BUCKET: 'test-bucket',
      S3_REGION: 'us-east-1',
      // Supply optional keys so they are present in the parsed output
      MAIZE_CONTRACT_ID: 'contract-id-placeholder',
      SESAME_CONTRACT_ID: 'contract-id-placeholder',
      JWT_EXPIRES_IN: '24h',
      ADMIN_PUBLIC_KEY: 'G123',
      STELLAR_RPC_URL: 'https://rpc.example.com',
      STELLAR_NETWORK_PASSPHRASE: 'Test SDF Network',
      FARMER_WALLET_ENCRYPTION_KEY: 'a'.repeat(64),
      S3_ENDPOINT: 'https://s3.example.com',
      S3_ACCESS_KEY_ID: 'key',
      S3_SECRET_ACCESS_KEY: 'secret',
      ALLOWED_ORIGINS: '',
      LOG_LEVEL: 'info',
      REDIS_URL: 'redis://localhost:6379',
    }
    const result = parseEnv(fullEnv)
    assert.ok(result.ok, `parseEnv failed: ${result.ok ? '' : result.errors.join(', ')}`)

    const envKeys = new Set(Object.keys(result.data))

    for (const entry of getEnabledCommodities()) {
      assert.ok(
        entry.contractIdEnvKey !== null,
        `${entry.code} is enabled but contractIdEnvKey is null`,
      )
      assert.ok(
        envKeys.has(entry.contractIdEnvKey as string),
        `${entry.code}.contractIdEnvKey "${entry.contractIdEnvKey}" is not a key in the env schema`,
      )
    }
  })
})

// ─── 3. Deposit via HTTP route ────────────────────────────────────────────────

describe('deposit route — registry-driven validation', () => {
  async function post(body: unknown) {
    return fetch(`${baseUrl}/api/v1/deposits`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  }

  test('valid MAIZE_WHITE + Grade A deposit succeeds (201)', async () => {
    const res = await post(validDeposit)
    assert.equal(res.status, 201)
    const body = (await res.json()) as any
    assert.equal(body.success, true)
  })

  test('MAIZE_WHITE with an invalid grade → 400 INVALID_GRADE listing valid grades', async () => {
    const res = await post({ ...validDeposit, grade: 'Grade X' })
    assert.equal(res.status, 400)
    const body = (await res.json()) as any
    assert.equal(body.success, false)
    assert.equal(body.code, 'INVALID_GRADE')
    assert.match(body.error, /Grade X/)
    // Error message must list all valid grades
    assert.match(body.error, /Grade A/)
    assert.match(body.error, /Grade B/)
    assert.match(body.error, /Grade C/)
  })

  test('SORGHUM → 400 COMMODITY_NOT_ENABLED', async () => {
    const res = await post({ ...validDeposit, commodity: 'SORGHUM', grade: 'Grade A' })
    assert.equal(res.status, 400)
    const body = (await res.json()) as any
    assert.equal(body.success, false)
    assert.equal(body.code, 'COMMODITY_NOT_ENABLED')
    assert.match(body.error, /SORGHUM/)
  })

  test('BANANA → 400 UNKNOWN_COMMODITY listing enabled commodities', async () => {
    const res = await post({ ...validDeposit, commodity: 'BANANA', grade: 'Grade A' })
    assert.equal(res.status, 400)
    const body = (await res.json()) as any
    assert.equal(body.success, false)
    assert.equal(body.code, 'UNKNOWN_COMMODITY')
    assert.match(body.error, /BANANA/)
    // Error must list enabled commodities
    assert.match(body.error, /MAIZE_WHITE/)
    assert.match(body.error, /SESAME/)
  })

  test('missing commodity → 400 standard validation error (no crash)', async () => {
    const { commodity: _drop, ...noComm } = validDeposit
    const res = await post(noComm)
    assert.equal(res.status, 400)
    const body = (await res.json()) as any
    assert.equal(body.success, false)
    // Plain Zod required-field error — no machine code expected
    assert.match(body.error, /commodity is required/)
  })
})

// ─── 4. Config-only extension guarantee ──────────────────────────────────────

describe('config-only extension — factory injection (no HTTP, pure schema)', () => {
  // Build a fake registry with a real commodity + two fake ones.
  // This is done entirely inside the test — zero production files change.

  const fakeEnabledEntry: CommodityEntry = {
    code: 'FAKE_GRAIN',
    displayName: 'Fake Grain',
    enabled: true,
    contractIdEnvKey: 'MAIZE_CONTRACT_ID', // reuse an existing env key
    validGrades: ['Grade A', 'Grade B'],
    bag: { standardKg: 50, overrideAllowed: false },
  }

  const fakeDisabledEntry: CommodityEntry = {
    code: 'FAKE_DISABLED',
    displayName: 'Fake Disabled',
    enabled: false,
    contractIdEnvKey: null,
    validGrades: [],
    bag: { standardKg: 50, overrideAllowed: false },
  }

  // Extend the default registry with the fakes
  const extendedRegistry = createRegistry([
    ...Array.from(COMMODITY_REGISTRY.values()),
    fakeEnabledEntry,
    fakeDisabledEntry,
  ])

  const testSchema = createDepositSchema(extendedRegistry)

  const baseBody = {
    farmerId: 'farmer-1',
    commodity: 'FAKE_GRAIN',
    grade: 'Grade A',
    bagCount: 5,
    weightPerBagKg: 50,
    warehouseId: 'wh-1',
  }

  test('FAKE_GRAIN with valid grade passes schema validation', () => {
    const result = testSchema.safeParse(baseBody)
    assert.equal(result.success, true, `Expected success but got: ${!result.success ? JSON.stringify(result.error.issues) : ''}`)
  })

  test('FAKE_GRAIN with invalid grade → INVALID_GRADE (Grade C not in FAKE_GRAIN grades)', () => {
    const result = testSchema.safeParse({ ...baseBody, grade: 'Grade C' })
    assert.equal(result.success, false)
    assert.ok(!result.success)
    const issue = result.error.issues.find(
      (i) => i.code === 'custom' && (i.params as any)?.code === 'INVALID_GRADE',
    )
    assert.ok(issue !== undefined, 'Expected INVALID_GRADE issue')
  })

  test('FAKE_GRAIN with unknown grade → INVALID_GRADE', () => {
    const result = testSchema.safeParse({ ...baseBody, grade: 'Grade Z' })
    assert.equal(result.success, false)
    assert.ok(!result.success)
    const issue = result.error.issues.find(
      (i) => i.code === 'custom' && (i.params as any)?.code === 'INVALID_GRADE',
    )
    assert.ok(issue !== undefined, 'Expected INVALID_GRADE issue')
    // Error lists valid grades for FAKE_GRAIN only
    assert.match(issue.message, /Grade A/)
    assert.match(issue.message, /Grade B/)
  })

  test('FAKE_DISABLED → COMMODITY_NOT_ENABLED', () => {
    const result = testSchema.safeParse({ ...baseBody, commodity: 'FAKE_DISABLED', grade: 'Grade A' })
    assert.equal(result.success, false)
    assert.ok(!result.success)
    const issue = result.error.issues.find(
      (i) => i.code === 'custom' && (i.params as any)?.code === 'COMMODITY_NOT_ENABLED',
    )
    assert.ok(issue !== undefined, 'Expected COMMODITY_NOT_ENABLED issue')
  })

  test('BANANA still → UNKNOWN_COMMODITY in extended registry', () => {
    const result = testSchema.safeParse({ ...baseBody, commodity: 'BANANA' })
    assert.equal(result.success, false)
    assert.ok(!result.success)
    const issue = result.error.issues.find(
      (i) => i.code === 'custom' && (i.params as any)?.code === 'UNKNOWN_COMMODITY',
    )
    assert.ok(issue !== undefined, 'Expected UNKNOWN_COMMODITY issue')
  })

  test('real MAIZE_WHITE still works in extended registry', () => {
    const result = testSchema.safeParse({
      ...baseBody,
      commodity: 'MAIZE_WHITE',
      grade: 'Grade A',
    })
    assert.equal(result.success, true)
  })
})

// ─── 5. Static guard ──────────────────────────────────────────────────────────

describe('static guard — no commodity literals in controllers or schemas', () => {
  const LITERALS = ['MAIZE_WHITE', 'MAIZE_YELLOW', 'SESAME', 'SORGHUM']
  const SRC_ROOT = new URL('../src', import.meta.url).pathname

  async function collectTsFiles(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true })
    const files: string[] = []
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        files.push(...(await collectTsFiles(full)))
      } else if (entry.isFile() && entry.name.endsWith('.ts')) {
        files.push(full)
      }
    }
    return files
  }

  test('src/controllers/**/*.ts contains no hard-coded commodity literals', async () => {
    const controllersDir = path.join(SRC_ROOT, 'controllers')
    const files = await collectTsFiles(controllersDir)
    const violations: string[] = []

    for (const file of files) {
      const content = await readFile(file, 'utf8')
      for (const literal of LITERALS) {
        // Look for the literal as a standalone string (quoted or as object key)
        // Allow the literal only as a comment (lines starting with //)
        const lines = content.split('\n')
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]
          // Skip comment lines
          if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) continue
          if (line.includes(literal)) {
            violations.push(`${path.relative(SRC_ROOT, file)}:${i + 1} — "${literal}"`)
          }
        }
      }
    }

    assert.deepEqual(
      violations,
      [],
      `Hard-coded commodity literals found in src/controllers:\n${violations.join('\n')}`,
    )
  })

  test('src/schemas/**/*.ts contains no hard-coded commodity literals', async () => {
    const schemasDir = path.join(SRC_ROOT, 'schemas')
    const files = await collectTsFiles(schemasDir)
    const violations: string[] = []

    for (const file of files) {
      const content = await readFile(file, 'utf8')
      for (const literal of LITERALS) {
        const lines = content.split('\n')
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]
          if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) continue
          if (line.includes(literal)) {
            violations.push(`${path.relative(SRC_ROOT, file)}:${i + 1} — "${literal}"`)
          }
        }
      }
    }

    assert.deepEqual(
      violations,
      [],
      `Hard-coded commodity literals found in src/schemas:\n${violations.join('\n')}`,
    )
  })
})

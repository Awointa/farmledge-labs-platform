/**
 * src/config/commodities.ts
 *
 * Single source of truth for every commodity the platform recognises.
 *
 * Design
 * ──────
 * • Registry keys are plain strings — a superset of the Prisma `Commodity`
 *   enum.  This lets us register future commodities (e.g. SORGHUM) before a
 *   Soroban contract or DB migration exists for them.
 * • `BAG_SIZE_CONFIG` (bagSizes.ts) is derived from this file, filtered to
 *   DB-backed commodities, so its shape and tests are unchanged.
 * • The deposit schema is driven by this registry at parse time; swap in a
 *   different registry via `createDepositSchema(registry)` in tests.
 *
 * Grade wire format
 * ─────────────────
 * DOC-2 (farmledge-labs-protocol/docs/GRADING_STANDARDS.md) defines canonical
 * protocol codes GRADE_A / GRADE_B / GRADE_C.  The existing wire API and DB
 * use the representations 'Grade A' / 'Grade B' / 'Grade C' and Grade_A /
 * Grade_B / Grade_C respectively.  For backwards compatibility `validGrades`
 * stores the wire-format strings ('Grade A' etc.) that the deposit endpoint
 * already accepts.  Protocol codes are referenced in comments only.
 *
 * Sorghum
 * ───────
 * Registered with `enabled: false` so the schema can return COMMODITY_NOT_ENABLED
 * rather than UNKNOWN_COMMODITY.  No Prisma enum value or DB migration is
 * created — that is Year-2 work (SORGHUM-1).
 */

import { Commodity } from '@prisma/client'
import type { Env } from './env.js'

// ─── Entry type ───────────────────────────────────────────────────────────────

export interface CommodityEntry {
  /** Canonical code.  For DB-backed commodities this equals the Prisma enum value. */
  code: string
  /** Human-readable label used in API responses and error messages. */
  displayName: string
  /**
   * Whether deposits for this commodity are currently accepted.
   * false → schema returns COMMODITY_NOT_ENABLED.
   */
  enabled: boolean
  /**
   * Key in `Env` whose value is the Soroban contract ID for this commodity.
   * null when no contract exists yet (disabled commodities).
   * For MAIZE_WHITE and MAIZE_YELLOW this points to the shared MAIZE_CONTRACT_ID.
   */
  contractIdEnvKey: keyof Env | null
  /**
   * Valid grade strings for this commodity, in wire-format order.
   * Source: DOC-2 (GRADING_STANDARDS.md) — protocol codes GRADE_A/B/C map to
   * these wire strings 'Grade A'/'Grade B'/'Grade C'.
   */
  validGrades: readonly string[]
  /** Bag-size configuration for this commodity. */
  bag: {
    /** Standard net weight per bag in kilograms. */
    standardKg: number
    /** Whether a custodian may record a different weight per bag at intake. */
    overrideAllowed: boolean
  }
}

// ─── Registry type ────────────────────────────────────────────────────────────

export type CommodityRegistry = ReadonlyMap<string, CommodityEntry>

// ─── Grade wire-format constants (from DOC-2 via wire convention) ─────────────

/**
 * All three valid grade wire-format strings, derived from DOC-2 grade codes
 * GRADE_A / GRADE_B / GRADE_C (GRADING_STANDARDS.md § Grade Codes).
 */
export const WIRE_GRADES = ['Grade A', 'Grade B', 'Grade C'] as const
export type WireGrade = (typeof WIRE_GRADES)[number]

// ─── Default entries ──────────────────────────────────────────────────────────

/**
 * The canonical list of commodities.  Edit this array — and only this array —
 * to add or change a commodity.  No other source file needs to change.
 */
const DEFAULT_ENTRIES: CommodityEntry[] = [
  // ── Maize White ────────────────────────────────────────────────────────────
  // DOC-2 commodity code: MAIZE_WHITE  (maize-receipt contract)
  // Grades: GRADE_A / GRADE_B / GRADE_C  (DOC-2 § Maize Grading Criteria)
  {
    code: 'MAIZE_WHITE',
    displayName: 'White Maize',
    enabled: true,
    contractIdEnvKey: 'MAIZE_CONTRACT_ID',
    validGrades: ['Grade A', 'Grade B', 'Grade C'],
    bag: { standardKg: 100, overrideAllowed: true },
  },

  // ── Maize Yellow ───────────────────────────────────────────────────────────
  // DOC-2 commodity code: MAIZE_YELLOW  (shared maize-receipt contract)
  // Grades: GRADE_A / GRADE_B / GRADE_C  (DOC-2 § Maize Grading Criteria)
  {
    code: 'MAIZE_YELLOW',
    displayName: 'Yellow Maize',
    enabled: true,
    contractIdEnvKey: 'MAIZE_CONTRACT_ID',
    validGrades: ['Grade A', 'Grade B', 'Grade C'],
    bag: { standardKg: 100, overrideAllowed: true },
  },

  // ── Sesame ─────────────────────────────────────────────────────────────────
  // DOC-2 commodity code: SESAME  (sesame-receipt contract)
  // Grades: GRADE_A / GRADE_B / GRADE_C  (DOC-2 § Sesame Grading Criteria)
  {
    code: 'SESAME',
    displayName: 'Sesame',
    enabled: true,
    contractIdEnvKey: 'SESAME_CONTRACT_ID',
    validGrades: ['Grade A', 'Grade B', 'Grade C'],
    bag: { standardKg: 80, overrideAllowed: true },
  },

  // ── Sorghum ────────────────────────────────────────────────────────────────
  // Registered but disabled — no Soroban contract exists yet (Year 2, SORGHUM-1).
  // No Prisma enum value; no DB migration.
  // validGrades: [] — pending; DOC-2 does not yet define sorghum grading criteria.
  {
    code: 'SORGHUM',
    displayName: 'Sorghum',
    enabled: false,
    contractIdEnvKey: null,
    // Pending: DOC-2 does not currently define sorghum grading criteria.
    // Will be populated when SORGHUM-1 is implemented.
    validGrades: [],
    bag: { standardKg: 100, overrideAllowed: true }, // design doc section 5.1
  },
]

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Build an immutable registry from a list of entries.
 *
 * Using a factory instead of a module-level constant lets tests inject a
 * custom registry into `createDepositSchema()` without module mocking.
 */
export function createRegistry(entries: CommodityEntry[]): CommodityRegistry {
  return new Map(entries.map((e) => [e.code, e])) as CommodityRegistry
}

/** Default registry — the single production instance. */
export const COMMODITY_REGISTRY: CommodityRegistry = createRegistry(DEFAULT_ENTRIES)

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Look up a commodity by code.
 * Returns `undefined` for unknown codes (not a registered commodity at all).
 */
export function getCommodityConfig(
  code: string,
  registry: CommodityRegistry = COMMODITY_REGISTRY,
): CommodityEntry | undefined {
  return registry.get(code)
}

/**
 * All enabled commodities in the registry, in insertion order.
 */
export function getEnabledCommodities(
  registry: CommodityRegistry = COMMODITY_REGISTRY,
): CommodityEntry[] {
  return Array.from(registry.values()).filter((e) => e.enabled)
}

/**
 * Enabled commodity codes (plain strings).
 * Convenience for building Zod enums or error messages.
 */
export function getEnabledCodes(
  registry: CommodityRegistry = COMMODITY_REGISTRY,
): string[] {
  return getEnabledCommodities(registry).map((e) => e.code)
}

/**
 * Type guard: is `code` a value of the Prisma `Commodity` enum?
 * Used by bagSizes.ts to filter registry entries to DB-backed commodities only.
 */
export function isDbCommodity(code: string): code is Commodity {
  return Object.values(Commodity).includes(code as Commodity)
}

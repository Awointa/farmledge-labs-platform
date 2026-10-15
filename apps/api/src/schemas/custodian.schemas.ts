/**
 * src/schemas/custodian.schemas.ts
 *
 * Zod schemas for the custodian endpoints.
 *
 * The `DepositSchema` is now driven by the commodity registry — no commodity
 * or grade literal appears here.  The `createDepositSchema(registry)` factory
 * lets tests inject a custom registry without module mocking or production
 * code changes.
 */

import { z } from 'zod'
import {
  COMMODITY_REGISTRY,
  getCommodityConfig,
  getEnabledCodes,
  type CommodityRegistry,
} from '../config/commodities.js'

// ─── DepositSchema factory ────────────────────────────────────────────────────

/**
 * Build a deposit validation schema driven by `registry`.
 *
 * Validation order:
 *  1. Structural parse (types, required fields) — standard Zod errors.
 *  2. `superRefine` — commodity existence, enabled flag, grade membership.
 *     Each failure sets a machine-readable `params.code` on the Zod issue so
 *     the validate middleware can include it in the HTTP response.
 *
 * Grade wire format: 'Grade A' / 'Grade B' / 'Grade C' (DOC-2 GRADE_A/B/C).
 */
export function createDepositSchema(registry: CommodityRegistry = COMMODITY_REGISTRY) {
  return z
    .object({
      farmerId: z
        .string({ required_error: 'farmerId is required' })
        .min(1, 'farmerId is required'),
      // Accept any string at the type level; registry validation happens in superRefine.
      commodity: z.string({ required_error: 'commodity is required' }).min(1, 'commodity is required'),
      // Accept any string at the type level; registry-driven grade check in superRefine.
      grade: z.string({ required_error: 'grade is required' }).min(1, 'grade is required'),
      bagCount: z
        .number({ required_error: 'bagCount is required' })
        .int('bagCount must be a whole number')
        .positive('bagCount must be positive'),
      weightPerBagKg: z
        .number({ required_error: 'weightPerBagKg is required' })
        .positive('weightPerBagKg must be positive'),
      warehouseId: z
        .string({ required_error: 'warehouseId is required' })
        .min(1, 'warehouseId is required'),
      // Optional scale reading captured at intake. When present it is authoritative
      // for total weight; otherwise total weight is derived from the standard bag size.
      actualWeighedKg: z
        .number()
        .positive('actualWeighedKg must be positive')
        .optional(),
    })
    .superRefine((data, ctx) => {
      const commodityCode = data.commodity

      // ── 1. Unknown commodity ──────────────────────────────────────────────
      const entry = getCommodityConfig(commodityCode, registry)
      if (entry === undefined) {
        const enabled = getEnabledCodes(registry)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['commodity'],
          message: `Unknown commodity "${commodityCode}". Valid commodities: ${enabled.join(', ')}`,
          params: { code: 'UNKNOWN_COMMODITY', enabledCommodities: enabled },
        })
        // Grade check cannot run without a valid commodity — abort.
        return z.NEVER
      }

      // ── 2. Commodity not enabled ──────────────────────────────────────────
      if (!entry.enabled) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['commodity'],
          message: `Commodity "${commodityCode}" is not currently enabled for deposits`,
          params: { code: 'COMMODITY_NOT_ENABLED', commodity: commodityCode },
        })
        return z.NEVER
      }

      // ── 3. Invalid grade ──────────────────────────────────────────────────
      if (!entry.validGrades.includes(data.grade)) {
        const validGrades = [...entry.validGrades]
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['grade'],
          message: `Invalid grade "${data.grade}" for ${entry.displayName}. Valid grades: ${validGrades.join(', ')}`,
          params: { code: 'INVALID_GRADE', validGrades },
        })
      }
    })
}

/** Production singleton — wired into the deposit route. */
export const DepositSchema = createDepositSchema()

/** Inferred output type of the production schema. */
export type DepositRequestBody = z.infer<typeof DepositSchema>

// ─── Other custodian schemas (unchanged) ──────────────────────────────────────

export const OnboardCustodianSchema = z
  .object({
    name: z.string({ required_error: 'name is required' }).min(1, 'name is required').max(120),
    location: z
      .string({ required_error: 'location is required' })
      .min(1, 'location is required')
      .max(255),
    state: z.string({ required_error: 'state is required' }).min(1, 'state is required').max(100),
    certified: z.boolean().optional().default(false),
    // Accept either camelCase or snake_case for capacity
    capacityTonnes: z.number().positive('capacityTonnes must be positive').optional(),
    capacity_tonnes: z.number().positive('capacity_tonnes must be positive').optional(),
    // Accept either camelCase or snake_case (or legacy aliases) for wallet
    custodianWallet: z.string().min(1).optional(),
    custodian_wallet: z.string().min(1).optional(),
    address: z.string().min(1).optional(),
    walletAddress: z.string().min(1).optional(),
  })
  .refine(
    (d) =>
      (d.capacityTonnes !== undefined || d.capacity_tonnes !== undefined) &&
      (d.custodianWallet ?? d.custodian_wallet ?? d.address ?? d.walletAddress) !== undefined,
    { message: 'capacityTonnes (or capacity_tonnes) and custodianWallet are required' },
  )

/**
 * Schema for the optional request body of POST /admin/lenders/:id/api-keys.
 * Only the `label` field is accepted; everything else is stripped.
 */
export const GenerateApiKeySchema = z.object({
  label: z
    .string()
    .min(1, 'label must not be empty')
    .max(80, 'label must be ≤ 80 characters')
    .optional(),
})

export const ExitSchema = z.object({
  exit_reason: z
    .string({ required_error: 'exit_reason is required' })
    .min(1, 'exit_reason is required')
    .max(500, 'exit_reason must be ≤ 500 characters'),
  delivery_note_number: z
    .string({ required_error: 'delivery_note_number is required' })
    .min(1, 'delivery_note_number is required')
    .max(100, 'delivery_note_number must be ≤ 100 characters'),
})

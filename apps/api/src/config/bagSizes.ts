/**
 * src/config/bagSizes.ts
 *
 * Bag-size configuration — derived from the commodity registry.
 *
 * The export shape (`BAG_SIZE_CONFIG`, `BagSizeEntry`) is identical to the
 * pre-registry version so that all BAGCFG-1 and BAGCFG-2 tests pass
 * unchanged.  The source of truth has moved to `commodities.ts`; editing
 * bag values there is all that is needed.
 */

import { Commodity } from '@prisma/client'
import { COMMODITY_REGISTRY, isDbCommodity } from './commodities.js'

export interface BagSizeEntry {
  /** Standard net weight per bag in kilograms */
  standardKg: number
  /** Whether a custodian may record a different weight per bag at intake */
  overrideAllowed: boolean
}

// Build the config by walking the registry and keeping only DB-backed,
// enabled commodities.  SORGHUM is registered but not in the Prisma enum, so
// it is automatically excluded here — no manual filtering needed.
export const BAG_SIZE_CONFIG: Record<Commodity, BagSizeEntry> = (() => {
  const result = {} as Record<Commodity, BagSizeEntry>
  for (const entry of COMMODITY_REGISTRY.values()) {
    if (entry.enabled && isDbCommodity(entry.code)) {
      result[entry.code] = {
        standardKg: entry.bag.standardKg,
        overrideAllowed: entry.bag.overrideAllowed,
      }
    }
  }
  return result
})()

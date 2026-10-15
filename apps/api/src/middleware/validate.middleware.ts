import { type Request, type Response, type NextFunction } from 'express'
import { type ZodSchema } from 'zod'

/**
 * Body-validation middleware factory.
 *
 * Parses `req.body` against the supplied Zod schema. On failure it responds
 * with `400` and a human-readable error message (the schema's own messages,
 * joined) rather than Zod's verbose default output. On success the parsed
 * (and stripped) value replaces `req.body` before handing off to the handler.
 *
 * Machine-readable codes
 * ──────────────────────
 * If any failing Zod issue carries a `params.code` string (set by custom
 * `superRefine` refinements), the *first* such code is included in the
 * response body as `code`.  Issues without a params.code are unaffected —
 * they still appear in `error` as plain text.
 *
 * Example response shape when a code is present:
 *   { "success": false, "error": "...", "code": "UNKNOWN_COMMODITY" }
 *
 * Example response shape for a plain type error (no code):
 *   { "success": false, "error": "farmerId is required" }
 */
export const validate = (schema: ZodSchema) =>
  (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body ?? {})
    if (!result.success) {
      const error = result.error.issues.map((issue) => issue.message).join(', ')

      // Extract the first machine-readable code, if any superRefine set one.
      // Zod custom issues carry an open-ended `params` object; we cast to access it.
      type CustomIssue = { code: string; params?: Record<string, unknown> }
      const codeIssue = result.error.issues.find(
        (issue) => {
          if (issue.code !== 'custom') return false
          const p = (issue as unknown as CustomIssue).params
          return p != null && typeof p.code === 'string'
        },
      )
      const machineCode =
        codeIssue != null
          ? ((codeIssue as unknown as CustomIssue).params as Record<string, unknown>).code as string
          : undefined

      const body: Record<string, unknown> = { success: false, error }
      if (machineCode !== undefined) {
        body.code = machineCode
      }

      res.status(400).json(body)
      return
    }
    req.body = result.data
    next()
  }

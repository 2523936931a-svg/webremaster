import { z } from "zod";
import { SITE_ID_PATTERN } from "./snapshot.js";

/** 单重门禁的判定明细。 */
export const VerificationGateSchema = z.object({
  gateName: z.string(),
  passed: z.boolean(),
  score: z.number(),
  details: z.string(),
});

/** VerificationReport：6 重门禁 + 提取器健康度 + Token 用量的验证报告。 */
export const VerificationReportSchema = z.object({
  siteId: z.string().regex(SITE_ID_PATTERN),
  passed: z.boolean(),
  repairRoundsUsed: z.number().int().nonnegative(),
  originalItemCount: z.number().int().nonnegative(),
  remasteredItemCount: z.number().int().nonnegative(),
  dataParityRatio: z.number().min(0).max(1),
  vlmScore: z.number().min(0).max(10),
  vlmFeedback: z.string(),
  gates: z.array(VerificationGateSchema).length(6),
  extractorHealthSummary: z.record(
    z.object({
      tier: z.number().int().min(1).max(4),
      hits: z.number().int().nonnegative(),
      misses: z.number().int().nonnegative(),
    }),
  ),
  totalTokensUsed: z.number().int().nonnegative(),
  verifiedAt: z.string().datetime({ offset: true }),
});

export type VerificationGate = z.infer<typeof VerificationGateSchema>;
export type VerificationReport = z.infer<typeof VerificationReportSchema>;

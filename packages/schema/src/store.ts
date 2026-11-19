import { z } from "zod";
import { ARCHETYPES, type Archetype } from "./contract.js";

/** 语义化版本号规则（SkinManifest 与 StoreIndex 的 version 共用）。 */
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

/** SkinManifest：商店中一款已编译皮肤的清单。 */
export const SkinManifestSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  targetUrl: z.string().url(),
  matchPatterns: z.array(z.string()).min(1),
  archetype: z.enum(ARCHETYPES),
  tagline: z.object({
    zh: z.string(),
    en: z.string(),
  }),
  enhancements: z.array(z.string()),
  userscriptFile: z.string(),
  beforeImage: z.string(),
  afterImage: z.string(),
  vlmScore: z.number().min(0).max(10),
  dataParityRatio: z.number().min(0).max(1),
  bundleSizeKb: z.number().nonnegative(),
  tokensUsedToCompile: z.number().int().nonnegative(),
  version: z.string().regex(VERSION_PATTERN),
});

/** StoreIndex：皮肤商店索引（零 Token 分发的目录层）。 */
export const StoreIndexSchema = z.object({
  version: z.string().regex(VERSION_PATTERN),
  totalSkins: z.number().int().nonnegative(),
  totalTokensBurned: z.number().int().nonnegative(),
  avgVlmScore: z.number().min(0).max(10),
  skins: z.array(SkinManifestSchema),
});

export type SkinManifest = z.infer<typeof SkinManifestSchema>;
export type StoreIndex = z.infer<typeof StoreIndexSchema>;

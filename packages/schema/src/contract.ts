import { z } from "zod";
import { PAIRING_MODES, SITE_ID_PATTERN, type PairingMode } from "./snapshot.js";

// 规格将 PAIRING_MODES 列为 contract.ts 的导出常量；其唯一定义位于 snapshot.ts
// （snapshot 与 contract 若互相在模块求值期读取对方绑定，会形成 ESM 循环依赖导致 TDZ 报错），
// 此处再导出以保持 contract.js 的导出面与规格一致。
export { PAIRING_MODES };

/** 站点原型：决定编译器套用的重制模板族。 */
export const ARCHETYPES = [
  "news-feed",
  "academic-archive",
  "data-table-portal",
  "doc-reader",
  "package-registry",
  "classifieds-grid",
  "forum-thread",
  "auth-portal",
] as const;

/** 字段提取的目标值类型。 */
export const FIELD_TYPES = ["string", "number", "url", "date", "boolean", "string[]"] as const;

/** 字段取值来源（DOM 属性）。 */
export const ATTRIBUTE_SOURCES = ["textContent", "href", "src", "value", "innerHTML"] as const;

/** 相对定位基准：节点自身 / 下一个兄弟节点 / 父节点。 */
export const RELATIVE_TO = ["self", "next-sibling", "parent"] as const;

/** 交互动作类型。 */
export const ACTION_KINDS = [
  "click",
  "fill_and_submit",
  "navigate",
  "toggle_checkbox",
  "select_option",
] as const;

/** 动作参数的值类型。 */
export const PARAM_TYPES = ["string", "number", "boolean"] as const;

/** 内置 PowerUp 清单（零 Token 商店的皮肤能力位）。 */
export const POWER_UP_IDS = [
  "cmd-k-search",
  "csv-markdown-export",
  "vim-navigation",
  "dark-light-theme",
  "reading-progress",
  "table-sort-filter",
  "thread-collapse",
  "turbo-nav",
] as const;

/** 活体传送门槽位类型（不能重制、必须原样嵌入的原站组件）。 */
export const PORTAL_SLOT_KINDS = ["captcha", "canvas", "video", "widget"] as const;

export type Archetype = (typeof ARCHETYPES)[number];
export type FieldType = (typeof FIELD_TYPES)[number];
export type AttributeSource = (typeof ATTRIBUTE_SOURCES)[number];
export type RelativeTo = (typeof RELATIVE_TO)[number];
export type ActionKind = (typeof ACTION_KINDS)[number];
export type ParamType = (typeof PARAM_TYPES)[number];
export type PowerUpId = (typeof POWER_UP_IDS)[number];
export type PortalSlotKind = (typeof PORTAL_SLOT_KINDS)[number];

/** 单条数据字段的提取规则（4 级抗改版提取的声明式目标）。 */
export const ItemFieldRuleSchema = z.object({
  fieldName: z.string(),
  fieldType: z.enum(FIELD_TYPES),
  selectors: z.array(z.string()).min(1),
  relativeTo: z.enum(RELATIVE_TO).optional(),
  attribute: z.enum(ATTRIBUTE_SOURCES),
  regexExtract: z.string().optional(),
  spatialLabelRegex: z.string().optional(),
  required: z.boolean(),
});

/** 单条路由的合同：指纹识别 + 字段提取规则 + 传送门槽位 + 交互动作。 */
export const ContractRouteSchema = z.object({
  routeId: z.string(),
  urlRegex: z.string(),
  domFingerprintSelector: z.string(),
  archetype: z.enum(ARCHETYPES),
  primaryListContainer: z.string().optional(),
  primaryItemSelector: z.string().optional(),
  pairingMode: z.enum(PAIRING_MODES).optional(),
  itemFields: z.array(ItemFieldRuleSchema).min(1),
  portalSlots: z
    .array(
      z.object({
        slotName: z.string(),
        description: z.string(),
        selectors: z.array(z.string()).min(1),
        kind: z.enum(PORTAL_SLOT_KINDS),
      }),
    )
    .optional(),
  actions: z
    .array(
      z.object({
        actionId: z.string(),
        description: z.string(),
        kind: z.enum(ACTION_KINDS),
        targetSelectors: z.array(z.string()).min(1),
        submitSelectors: z.array(z.string()).optional(),
        paramSchema: z.record(z.enum(PARAM_TYPES)).optional(),
      }),
    )
    .optional(),
});

/** SiteContract：单站多路由数据合同（编译器的施工图）。 */
export const SiteContractSchema = z.object({
  siteId: z.string().regex(SITE_ID_PATTERN),
  siteName: z.string(),
  matchPatterns: z.array(z.string()).min(1),
  routes: z.array(ContractRouteSchema).min(1),
  enableTurboNav: z.boolean().default(true),
  recommendedPowerUps: z
    .array(z.enum(POWER_UP_IDS))
    .default([]),
});

export type ItemFieldRule = z.infer<typeof ItemFieldRuleSchema>;
export type ContractRoute = z.infer<typeof ContractRouteSchema>;
export type SiteContract = z.infer<typeof SiteContractSchema>;

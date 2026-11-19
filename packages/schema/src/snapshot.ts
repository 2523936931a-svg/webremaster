import { z } from "zod";

/**
 * 站点 ID 规则：仅小写字母、数字与连字符（kebab-case）。
 */
export const SITE_ID_PATTERN = /^[a-z0-9-]+$/;

/**
 * 主题色规则：# 开头的 6 位十六进制（大小写均可）。
 */
export const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/**
 * 重复组配对模式：single 单项独立 / paired-next-sibling 相邻兄弟配对 / dt-dd-pair 定义列表对。
 * 唯一定义放在 snapshot.ts：snapshot 与 contract 都在模块求值期使用它，
 * 若定义在 contract.ts 会与 SITE_ID_PATTERN 形成 ESM 循环依赖（双方求值期互读绑定，TDZ 报错）；
 * contract.ts 会将其再导出，保持规格要求的导出面不变。
 */
export const PAIRING_MODES = ["single", "paired-next-sibling", "dt-dd-pair"] as const;

export type PairingMode = (typeof PAIRING_MODES)[number];

/** 视口尺寸（像素，正整数）。 */
export const ViewportSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

/** 同源 frame 的最小还原信息。 */
export const SameOriginFrameSchema = z.object({
  frameId: z.string(),
  src: z.string(),
  title: z.string(),
  skeletonHtml: z.string(),
});

/** 快照阶段识别出的重复组（列表 / 表格 / 卡片流）。 */
export const RepeatedGroupSchema = z.object({
  groupId: z.string(),
  containerSelector: z.string(),
  itemSelector: z.string(),
  pairingMode: z.enum(PAIRING_MODES),
  companionSelector: z.string().optional(),
  totalCount: z.number().int().nonnegative(),
  sampleItemsHtml: z.array(z.string()).max(3),
});

/** 需要活体桥接的可交互元素（表单 / 链接 / 验证码 / canvas 等）。 */
export const InteractiveElementSchema = z.object({
  id: z.string(),
  tag: z.string(),
  role: z.string().optional(),
  type: z.string().optional(),
  label: z.string(),
  selectors: z.array(z.string()).min(1),
  formAction: z.string().optional(),
  formMethod: z.string().optional(),
  hasCsrfOrHiddenInputs: z.boolean(),
  isCaptchaOrCanvas: z.boolean(),
  frameId: z.string().optional(),
  boundingBox: z
    .object({
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
    })
    .optional(),
});

/** SiteSnapshot：抓取阶段的完整产物，编译器唯一的数据事实来源。 */
export const SiteSnapshotSchema = z.object({
  siteId: z.string().regex(SITE_ID_PATTERN),
  url: z.string().url(),
  matchPatterns: z.array(z.string()).min(1),
  capturedAt: z.string().datetime({ offset: true }),
  title: z.string(),
  viewport: ViewportSchema,
  hasFramesetOrIframes: z.boolean(),
  sameOriginFrames: z.array(SameOriginFrameSchema),
  domSkeletonHtml: z
    .string()
    .refine((v) => new TextEncoder().encode(v).length <= 16 * 1024, {
      message: "domSkeletonHtml must be ≤ 16KB UTF-8",
    }),
  repeatedGroups: z.array(RepeatedGroupSchema),
  interactiveElements: z.array(InteractiveElementSchema),
  originalItemCountHint: z.number().int().nonnegative(),
  beforeScreenshotPath: z.string(),
});

export type Viewport = z.infer<typeof ViewportSchema>;
export type SameOriginFrame = z.infer<typeof SameOriginFrameSchema>;
export type RepeatedGroup = z.infer<typeof RepeatedGroupSchema>;
export type InteractiveElement = z.infer<typeof InteractiveElementSchema>;
export type SiteSnapshot = z.infer<typeof SiteSnapshotSchema>;

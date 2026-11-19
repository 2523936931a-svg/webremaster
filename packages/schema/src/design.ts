import { z } from "zod";
import { HEX_COLOR_PATTERN, SITE_ID_PATTERN } from "./snapshot.js";

/** UXDesignSpec：设计阶段产出（主题标识 / 布局策略 / 组件蓝图）。 */
export const UXDesignSpecSchema = z.object({
  siteId: z.string().regex(SITE_ID_PATTERN),
  themeIdentity: z.object({
    brandAccentHex: z.string().regex(HEX_COLOR_PATTERN),
    darkBgHex: z.string().regex(HEX_COLOR_PATTERN),
    lightBgHex: z.string().regex(HEX_COLOR_PATTERN),
    aestheticStyle: z.string(),
  }),
  layoutStrategy: z.string(),
  keyEnhancements: z.array(z.string()),
  componentBlueprint: z.string(),
});

export type UXDesignSpec = z.infer<typeof UXDesignSpecSchema>;

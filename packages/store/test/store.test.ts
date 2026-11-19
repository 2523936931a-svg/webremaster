import { describe, it, expect } from "vitest";
import { DICTIONARY } from "../src/i18n.js";
import { loadStoreIndex } from "../src/lib/storeLoader.js";
import { StoreIndexSchema } from "@webremaster/schema";

describe("WebRemaster Store", () => {
  it("国际化字典 zh 与 en 词条完全对称", () => {
    const zhKeys = Object.keys(DICTIONARY.zh).sort();
    const enKeys = Object.keys(DICTIONARY.en).sort();
    expect(zhKeys).toEqual(enKeys);
    expect(zhKeys.length).toBeGreaterThan(20);
  });

  it("loadStoreIndex 兜底返回值完全符合 StoreIndexSchema 契约", async () => {
    const index = await loadStoreIndex();
    expect(index).toBeDefined();
    const validated = StoreIndexSchema.parse(index);
    expect(validated.skins.length).toBeGreaterThanOrEqual(1);
    expect(validated.version).toBe("0.1.0");
  });
});

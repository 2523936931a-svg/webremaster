---
name: webremaster-skin-compiler
description: Compile any ugly legacy website into a zero-token, Shadow-DOM isolated React+Tailwind Userscript (.user.js) using WebRemaster's local Playwright inspector, bundler, and 6-gate verifier.
---

# WebRemaster Agent-Native Skin Compiler Skill

When asked to remaster a legacy website `<url>` with ID `<siteId>`:

1. **Inspect (DOM X-Ray)**:
   Run `pnpm wr inspect <url> --id <siteId>`.
   Read `skins/<siteId>/01_snapshot.json` and view `skins/<siteId>/before.png`.

2. **Analyze & Design**:
   Fastest path: run `pnpm wr scaffold <siteId> --url <url> --archetype <news-feed|doc-reader|data-table-portal|academic-archive|package-registry|classifieds-grid|forum-thread|auth-portal>` — it derives the primary list selector from the snapshot's largest repeated group, strips `html > body` prefixes, and emits contract/design/`entry.tsx`/`skin.css` that already build and pass the six gates (see `examples/local-1998/`). Edit from there instead of writing everything from scratch.
   Otherwise write `skins/<siteId>/02_contract.json` (conforming to `SiteContractSchema`) and `skins/<siteId>/03_design.json` (conforming to `UXDesignSpecSchema`).
   Ensure all CSS selectors exist verbatim in `01_snapshot.json` with 2-3 fallbacks.

3. **Generate Skin Code**:
   Write `skins/<siteId>/src/entry.tsx` exporting a **default** `mountSkin(context)` function, and import `./skin.css` from it. This single entry is the required contract; split into `adapter.ts` / `SkinApp.tsx` only when the skin exceeds ~300 lines.
   Use APIs that actually exist in `@webremaster/bridge`: `extractFieldWithCascade`, `createOriginStore`, `HealthTracker`, `TurboNavigator`, `nativeSetInputValue`, `nativeTriggerClick`, `nativeSubmitForm`, `CommandPalette`, `EscapePill`, `exportToCSV`, `exportToMarkdownTable`, `useVimNavigation`. Do **not** import `queryWithFallback` — there is no such export.
   - Query ONLY inside `originRoot`.
   - Tag every rendered list item with `data-wr-item="true"`.
   - Support dark/light toggle + `Alt+Shift+R` escape + `Cmd+K` search.

4. **Build & Fix Loop**:
   Run `pnpm wr build-skin <siteId>`. If TypeScript or Vite fails, fix the exact errors and rebuild (max 4 tries).

5. **Live Browser Verification & Visual Audit**:
   Run `pnpm wr verify-skin <siteId> --no-vlm`.
   Inspect `skins/<siteId>/05_verification.json` AND visually compare `skins/<siteId>/before.png` vs `skins/<siteId>/after.png`.
   - If any of the six gates fails OR visual quality is below 8.5/10 (overflow, contrast, missing data, broken styling), surgically repair `entry.tsx` and repeat Steps 4-5 (max 4 rounds).
   - If the target site is unreachable from your network, replay it from a local fixture instead of skipping verification: `pnpm wr verify-skin <siteId> --no-vlm --fixture configs/<siteId>-recon/front.html` (the report will be tagged "离线 fixture 回放" and no screenshots are overwritten).

6. **Finalize & Sync**:
   Once all six gates pass AND visual quality >= 8.5/10, run:
   `pnpm wr finalize-skin <siteId> --vlm-score <score> --category <cat> --tagline-zh "<zh>" --tagline-en "<en>"`
   Then run `pnpm sync:artifacts` to update the Chrome Extension and Before/After Store automatically.

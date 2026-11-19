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
   Write `skins/<siteId>/02_contract.json` (conforming to `SiteContractSchema`) and `skins/<siteId>/03_design.json` (conforming to `UXDesignSpecSchema`).
   Ensure all CSS selectors exist verbatim in `01_snapshot.json` with 2-3 fallbacks.

3. **Generate Skin Code**:
   Write `skins/<siteId>/src/adapter.ts` and `skins/<siteId>/src/SkinApp.tsx` using `@webremaster/bridge` (`queryWithFallback`, `nativeSetInputValue`, `nativeTriggerClick`, `nativeSubmitForm`, `CommandPalette`, `EscapePill`, `exportToCSV`, `exportToMarkdownTable`, `useVimNavigation`).
   - Query ONLY inside `originRoot`.
   - Tag every rendered list item with `data-wr-item="true"`.
   - Support dark/light toggle + `Alt+Shift+R` escape + `Cmd+K` search.

4. **Build & Fix Loop**:
   Run `pnpm wr build-skin <siteId>`. If TypeScript or Vite fails, fix the exact errors and rebuild (max 4 tries).

5. **Live Browser Verification & Visual Audit**:
   Run `pnpm wr verify-skin <siteId> --no-vlm`.
   Inspect `skins/<siteId>/05_verification.json` AND visually compare `skins/<siteId>/before.png` vs `skins/<siteId>/after.png`.
   - If any deterministic gate (1-5) fails OR visual quality is below 8.5/10 (overflow, contrast, missing data, broken styling), surgically repair `adapter.ts`/`SkinApp.tsx` and repeat Steps 4-5 (max 4 rounds).

6. **Finalize & Sync**:
   Once all 5 deterministic gates pass AND visual quality >= 8.5/10, run:
   `pnpm wr finalize-skin <siteId> --vlm-score <score> --category <cat> --tagline-zh "<zh>" --tagline-en "<en>"`
   Then run `pnpm sync:artifacts` to update the Chrome Extension and Before/After Store automatically.

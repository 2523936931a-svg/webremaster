# 🏛️ WebRemaster

**Turn 1998-era websites into modern React interfaces — with zero runtime LLM calls.**

Compile-time inspection · Shadow DOM isolation · Zero-flash boot · Chrome MV3 extension

[![CI](https://github.com/webremaster/webremaster/actions/workflows/ci.yml/badge.svg)](https://github.com/webremaster/webremaster/actions/workflows/ci.yml)
[![Tests](https://img.shields.io/badge/Tests-154%20passing-brightgreen.svg)](https://github.com/webremaster/webremaster)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![React 19](https://img.shields.io/badge/React-19.0-61dafb.svg)](https://react.dev/)

[Try it live, no install](https://webremaster.github.io/webremaster/#live-demo) · [Online skin gallery](https://webremaster.github.io/webremaster/) · [Architecture whitepaper](docs/PROJECT_SHOWCASE.md) · [Download extension](https://github.com/webremaster/webremaster/releases)

![WebRemaster — Hacker News, before and after](docs/demo.gif)

---

## Why this exists

A lot of the web's most useful content still lives on pages designed in 1998: Hacker News, arXiv, DBLP, university portals, RFC documents, mailing-list archives. The content is irreplaceable. The interface is hostile — fixed-width tables, 12px type, no mobile viewport, no dark mode, no keyboard navigation.

Stylus themes and Tampermonkey scripts have tried to fix this for years, and they keep failing for four structural reasons:

1. **Flash of unstyled content (FOUC).** The ugly page renders first, the theme arrives a second later.
2. **CSS bleed.** Global `table, tr, td` rules from the old site and from your theme fight each other.
3. **Broken origin logic.** Replacing the DOM kills ASP.NET `__VIEWSTATE`, CSRF tokens, and jQuery listeners, so login and forms stop working.
4. **Runtime LLM cost.** Re-generating a page on every visit means seconds of latency and an API bill you cannot sustain.

WebRemaster moves the expensive part to **compile time** and ships a **zero-token runtime**.

---

## How it works

**Compile time** — a Playwright inspector maps the target DOM (skeleton, selectors, form controls, paired rows), writes a declarative contract, generates a React 19 + Tailwind v4 skin, bundles it into a single `.user.js`, and runs six deterministic gates plus a visual review.

**Runtime** — a dependency-free browser SDK handles the parts that are hard to get right:

| Runtime piece | What it solves |
| :--- | :--- |
| Zero-Flash Curtain | Dark overlay from `document-start`; lifts only when the remastered UI is mounted |
| Shadow DOM mount | Physical style isolation, in both directions |
| Hidden Origin | Keeps the original DOM alive for cookies, CSRF and native form submits |
| 4-tier extractor | Selector chain → sibling → spatial heuristic → semantic fallback, with per-field health telemetry |
| TurboNav | Prefetch on hover/touch, partial DOM swap, view transitions, scroll restoration |
| PowerUps | Reader mode, bookmarks, `Cmd+K` palette, Vim keys, CSV/Markdown export, element zapper |
| Split view | Live side-by-side original vs remastered, with a draggable divider |

---

## Try it live, in 30 seconds

The store ships a `#live-demo` section: it loads an offline 1998 Hacker News snapshot into an iframe and injects the compiled `hackernews.user.js` into it — what you see is the real runtime, not a recording.

- **Two routes**: `/front` (feed) and `/item` (thread) snapshots, hitting the feed and thread routes respectively
- **Three states**: Remastered → Split → Original, and the split divider is draggable
- **No install**: pure front-end; no Tampermonkey, no extension, no API key

![Try it live: 1998 original on the left, remastered on the right](docs/playground.png)

At 390px it is still a complete first screen — two-line headline, both CTAs, the before/after image and the state switcher — and the skin inside the iframe drops its subtitle and wraps item titles to two lines instead of cramming the desktop layout into a phone.

<img src="docs/mobile.png" width="320" alt="390px first screen: headline, CTAs, before/after image and state switcher all visible" />

[🔗 Open the store →](https://webremaster.github.io/webremaster/#live-demo)

---

## Proof it isn't just one hand-polished screenshot: a second skin in 3 minutes

`skins/hackernews` is hand-crafted, which invites the fair question "is the compiler doing anything?" `examples/local-1998/` is a 1998-style local page, and the whole chain below runs **without writing a single line of skin code**:

```bash
node examples/local-1998/server.cjs                                   # serve a 1998-era site
pnpm wr inspect http://127.0.0.1:4190/ --id demo1998 --out-dir ./skins-tmp
pnpm wr scaffold demo1998 --url http://127.0.0.1:4190/ --skins-dir ./skins-tmp --archetype news-feed
pnpm wr build-skin demo1998 --skins-dir ./skins-tmp
pnpm wr verify-skin demo1998 --no-vlm --skins-dir ./skins-tmp
```

The measured result lives in [`examples/local-1998/05_verification.json`](examples/local-1998/05_verification.json): **6/6 gates green, 100% data parity (20 → 20), `title` and `url` both at `tier=1 hits=40 misses=0`**. It also pins the four defects that `scaffold` templates used to have (imaginary APIs, missing default export, `html > body` selector prefixes, CSS not scanning ui-kit), so any regression turns this example red immediately.

---

## Agent-native: the whole job is a procedure an agent can follow

The repo ships [`skills/webremaster/SKILL.md`](skills/webremaster/SKILL.md): not a vague prompt, but a six-step procedure — inspect the DOM, write contract + design, generate `entry.tsx`, bundle, run the six gates, finalize and sync.

- **Real APIs only**: the procedure names the exports that actually exist in `bridge` (`extractFieldWithCascade`, `createOriginStore`, `HealthTracker`, `TurboNavigator`, `nativeSetInputValue`, …) and explicitly forbids `queryWithFallback`, which does not. This document once taught that non-existent export; today both review and the `scaffold` assertions watch it.
- **Real commands**: every `pnpm wr …` matches `--help`; `inspect` and `scaffold` need no model key at all.
- **Start from runnable code**: `wr scaffold` emits a skeleton that already builds and passes the gates, so an agent edits working code instead of an empty file.

Clients that support Skills (Claude Code, Cursor, Doubao work mode, …) can load `skills/webremaster/` as a skill directory.

---

## Repository layout

```text
packages/
  schema/      # Zod contracts: snapshot, site contract, design spec, verification, manifest
  bridge/      # Zero-dependency runtime SDK (curtain, origin manager, TurboNav, PowerUps)
  ui-kit/      # Component library: shell, feed cards, data table, thread tree, reader layout
  compiler/    # Playwright X-Ray, Vite bundler, six-gate verifier, `wr` CLI
  extension/   # Chrome MV3 extension (badge state, context menu, popup controls)
  store/       # Before/After gallery, deployed to GitHub Pages
skins/         # Compiled skins: source, contract, design, screenshots, gate report, .user.js
examples/      # End-to-end regression site (local-1998: generate a second skin, pass six gates)
configs/       # Site roadmap (top40_sites.yaml)
docs/          # Whitepaper, launch checklist, demo assets
```

---

## Deploy it to your own GitHub (one command)

Badges, the live demo, Releases, Pages and the `repository` field all point at the placeholder org `webremaster`. Switching to a real account:

```bash
pnpm set-owner <your-github-username>      # idempotent
git remote add origin git@github.com:<you>/webremaster.git
git push -u origin master
git tag v0.1.0 && git push --tags          # release.yml builds the extension zip
```

Then fill in four fields under **Settings**: Description, Topics (`userscript` / `chrome-extension` / `shadow-dom` / `react`), Social preview (`packages/store/public/og.png`), and Pages source = **GitHub Actions**.

---

## Quick start

```bash
git clone https://github.com/webremaster/webremaster.git
cd webremaster
pnpm install
pnpm wr doctor          # checks Node 22, Playwright browsers, skin readiness
pnpm typecheck          # 6 packages, strict
pnpm test               # 154 tests
pnpm build:all
```

Load the extension: open `chrome://extensions/`, enable **Developer mode**, click **Load unpacked**, choose `packages/extension/dist/`, then visit `https://news.ycombinator.com/`.

<img src="docs/popup.png" width="320" alt="Extension popup: three-step onboarding on first install, with a primary CTA to a covered site" />

A fresh install opens with a three-step onboarding card (open a covered site → the icon flips to ON → `Alt+Shift+R` to compare with the original / `Ctrl+K` for the command palette). When the current tab isn't covered, the primary button takes you straight to Hacker News instead of dead-ending on "not supported". On a covered site it shows the active skin, where the score came from (human review vs. automatic VLM), a per-site toggle and four remote controls.

Try the gallery locally:

```bash
pnpm dev                # http://localhost:5173
```

---

## The `wr` CLI

| Command | What it does |
| :--- | :--- |
| `wr doctor` | Environment health report |
| `wr list` | Roadmap and skin status board |
| `wr inspect <url> --id <siteId>` | DOM X-Ray → `01_snapshot.json` + `before.png` |
| `wr scaffold <siteId>` | Contract, design spec, React entry, styles |
| `wr dev <siteId>` | HMR bridge against the live site |
| `wr build-skin <siteId>` | TypeScript gate + Vite IIFE bundle → `<siteId>.user.js` |
| `wr verify-skin <siteId>` | Live six-gate verification → `after.png` + `05_verification.json` |
| `wr finalize-skin <siteId>` | Final review (gates green + visual score) |
| `wr sync:artifacts` | Push approved skins into the extension and the gallery |

---

## Status

**1 of 40 skins shipped** — Hacker News (`skins/hackernews/`), with a full gate report and before/after/split screenshots.

Next targets: Lobsters, arXiv, V2EX, 阮一峰博客. The full roadmap lives in `configs/top40_sites.yaml`. Open a **Site remaster request** issue and we'll prioritise by 👍.

---

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) for the six-step skin pipeline and gate rules. Security reports go through [SECURITY.md](SECURITY.md); community expectations are in [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## License

MIT — see [LICENSE](LICENSE).

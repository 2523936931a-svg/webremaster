#!/usr/bin/env node
/**
 * 检查仓库文档里的相对链接与图片是否真的存在。
 *
 * GitHub 上图片 404 是最伤的展示事故（截图改名、目录搬迁都会踩），
 * 而 CI 此前只跑构建与测试，不会发现这类问题。
 *
 *   pnpm check:docs
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const TARGETS = [
  "README.md",
  "README.en.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "CODE_OF_CONDUCT.md",
  "CHANGELOG.md",
  ...walkMarkdown("docs"),
  ...walkMarkdown("examples"),
  ...walkMarkdown("skins", true),
];

function walkMarkdown(dir, onlyReadme = false) {
  const abs = path.join(repoRoot, dir);
  if (!existsSync(abs)) return [];
  const out = [];
  for (const entry of readdirSync(abs)) {
    const full = path.join(abs, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walkMarkdown(path.join(dir, entry), onlyReadme));
      continue;
    }
    if (!entry.endsWith(".md")) continue;
    if (onlyReadme && entry !== "README.md") continue;
    out.push(path.join(dir, entry));
  }
  return out;
}

// [文本](目标) 与 <img src="目标">
const LINK_PATTERNS = [/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, /<img[^>]+src="([^"]+)"/g];

let checked = 0;
const missing = [];
const seen = new Set();

for (const rel of TARGETS) {
  const file = path.join(repoRoot, rel);
  if (!existsSync(file)) {
    missing.push({ from: "(target)", to: rel, reason: "文件本身不存在" });
    continue;
  }
  const content = readFileSync(file, "utf-8");
  for (const pattern of LINK_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const raw = match[1];
      const key = `${rel}->${raw}`;
      if (seen.has(key)) continue;
      seen.add(key);

      // 外链、锚点、邮件、绝对路径、变量插值一律跳过
      if (/^(https?:|mailto:|#|data:|\/)/i.test(raw)) continue;
      if (raw.includes("${{") || raw.includes("<")) continue;

      // 本机绝对路径（file:///D:/…）在 GitHub 上必然失效，直接判错
      if (/^file:/i.test(raw)) {
        checked++;
        missing.push({ from: rel, to: raw, reason: "本机 file:// 链接，推送到 GitHub 后不可用" });
        continue;
      }

      const target = raw.split("#")[0].split("?")[0];
      if (!target) continue;
      checked++;

      const resolved = path.resolve(repoRoot, path.dirname(rel), target);
      if (!existsSync(resolved)) {
        missing.push({ from: rel, to: raw, reason: "目标不存在" });
      }
    }
  }
}

if (missing.length > 0) {
  console.error(`✗ 文档链接检查失败：${missing.length} 处失效（共检查 ${checked} 处）`);
  for (const item of missing) {
    console.error(`  ${item.from} → ${item.to}（${item.reason}）`);
  }
  process.exit(1);
}

console.log(`✓ 文档链接检查通过：${checked} 处相对链接 / 图片全部存在（${TARGETS.length} 个文件）`);

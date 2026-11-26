#!/usr/bin/env node
/**
 * 把仓库里的占位组织名换成你自己的 GitHub 账号。
 *
 *   pnpm set-owner <github-username>
 *
 * 会改写 README（badge / 在线试用 / Release 链接）、CHANGELOG 的比较链接、
 * 项目介绍书、上线清单、根 package.json 的 repository / homepage / bugs，
 * 以及商店页的 og:image 绝对地址。脚本幂等，重复执行只会把旧 owner 再换一次。
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PLACEHOLDER_OWNER = "webremaster";
const REPO_NAME = "webremaster";
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "release", "skins-tmp", "coverage"]);
const EXTENSIONS = new Set([".md", ".json", ".html", ".yml", ".yaml", ".ts", ".txt"]);

const owner = (process.argv[2] || "").trim();
if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(owner)) {
  console.error("用法: pnpm set-owner <github-username> [repo-name]");
  console.error("用户名只能包含字母、数字与连字符（GitHub 的规则）。");
  process.exit(1);
}
const repo = (process.argv[3] || "webremaster").trim();
if (!/^[A-Za-z0-9._-]{1,100}$/.test(repo)) {
  console.error("仓库名只允许字母、数字、点、下划线与连字符。");
  process.exit(1);
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const replacements = [
  // 先替换裸的 owner/repo，完整 github.com URL 会随之正确
  [`${PLACEHOLDER_OWNER}/${REPO_NAME}`, `${owner}/${repo}`],
  // Pages 域名不含 owner/repo 的短形式，单独处理
  [`${PLACEHOLDER_OWNER}.github.io/${REPO_NAME}`, `${owner}.github.io/${repo}`],
];

let changedFiles = 0;
let changedHits = 0;

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full);
      continue;
    }
    if (!EXTENSIONS.has(path.extname(entry))) continue;
    if (stat.size > 512 * 1024) continue;

    const original = readFileSync(full, "utf-8");
    let next = original;
    let hits = 0;
    for (const [from, to] of replacements) {
      if (!next.includes(from)) continue;
      hits += next.split(from).length - 1;
      next = next.split(from).join(to);
    }
    if (next === original) continue;
    writeFileSync(full, next, "utf-8");
    changedFiles++;
    changedHits += hits;
    console.log(`  ~ ${path.relative(repoRoot, full)} (${hits})`);
  }
}

console.log(`把占位组织 "${PLACEHOLDER_OWNER}" 换成 "${owner}" …`);
walk(repoRoot);
console.log(`\n完成：${changedFiles} 个文件、${changedHits} 处引用已更新。`);
console.log("下一步：git remote add origin " + `git@github.com:${owner}/${repo}.git` + " && git push -u origin master");

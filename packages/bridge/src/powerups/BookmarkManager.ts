/**
 * BookmarkManager PowerUp —— 客户端本地零依赖稍后阅读 / 书签收藏系统（借鉴 Pocket / Readwise）。
 *
 * 即使老旧网站（如 Hacker News、arXiv、SQLite Docs、高校教务）原生没有书签或需要繁琐注册，
 * WebRemaster 自动为所有重制站点提供基于 localStorage 的本地高隐私稍后阅读功能。
 */

export interface BookmarkItem {
  id: string;
  title: string;
  url?: string;
  domain?: string;
  category?: string;
  savedAt: string;
}

const STORAGE_KEY = "webremaster_saved_bookmarks";

function getStorage(): Storage | null {
  if (typeof window !== "undefined" && window.localStorage) {
    return window.localStorage;
  }
  return null;
}

export function getBookmarks(): BookmarkItem[] {
  const storage = getStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveBookmark(item: Omit<BookmarkItem, "savedAt">): BookmarkItem {
  const existing = getBookmarks();
  const filtered = existing.filter((b) => b.id !== item.id);
  const bookmark: BookmarkItem = {
    ...item,
    savedAt: new Date().toISOString(),
  };
  filtered.unshift(bookmark); // 最新的置于最前
  const storage = getStorage();
  if (storage) {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(filtered));
    } catch {
      /* 存储空间满或被禁用时不阻断 */
    }
  }
  return bookmark;
}

export function removeBookmark(id: string): void {
  const existing = getBookmarks();
  const next = existing.filter((b) => b.id !== id);
  const storage = getStorage();
  if (storage) {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }
}

export function isBookmarked(id: string): boolean {
  return getBookmarks().some((b) => b.id === id);
}

export function toggleBookmark(item: Omit<BookmarkItem, "savedAt">): boolean {
  if (isBookmarked(item.id)) {
    removeBookmark(item.id);
    return false;
  } else {
    saveBookmark(item);
    return true;
  }
}

export function exportBookmarksToMarkdown(): string {
  const bookmarks = getBookmarks();
  if (bookmarks.length === 0) return "# 我的 WebRemaster 收藏夹\n\n暂无收藏内容。";
  const lines = ["# 我的 WebRemaster 收藏夹", "", `共 ${bookmarks.length} 条稍后阅读：`, ""];
  for (const b of bookmarks) {
    const link = b.url ? `[${b.title}](${b.url})` : b.title;
    const meta = [b.domain, b.category, b.savedAt.slice(0, 10)].filter(Boolean).join(" · ");
    lines.push(`- **${link}** ${meta ? `(${meta})` : ""}`);
  }
  return lines.join("\n");
}

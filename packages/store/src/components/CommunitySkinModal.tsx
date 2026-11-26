import React, { useState } from "react";
import { DICTIONARY, type Language } from "../i18n.js";
import { SkinManifestSchema, type SkinManifest } from "@webremaster/schema";
import { X, Sparkles, AlertCircle, CheckCircle2, Upload, FileCode } from "lucide-react";

export interface CommunitySkinModalProps {
  isOpen: boolean;
  lang: Language;
  onClose: () => void;
  onSkinImported: (skin: SkinManifest) => void;
}

const SAMPLE_COMMUNITY_SKIN: SkinManifest = {
  id: "arxiv-minimal-dark",
  name: "arXiv Minimal Dark Reader",
  category: "学术科研",
  targetUrl: "https://arxiv.org/list/cs.AI/recent",
  matchPatterns: ["https://arxiv.org/list/*", "https://arxiv.org/abs/*"],
  archetype: "doc-reader",
  tagline: {
    zh: "arXiv 现代高对比暗黑极简学术排版：公式 KaTeX 原生提速 + 一键 BibTeX 导出",
    en: "arXiv modern high-contrast academic skin: fast KaTeX rendering + one-click BibTeX export",
  },
  enhancements: [
    "cmd-k-search",
    "csv-markdown-export",
    "zen-reading-mode",
    "dark-light-theme",
  ],
  userscriptFile: "arxiv-minimal-dark.user.js",
  beforeImage: "before.png",
  afterImage: "after.png",
  vlmScore: 9.4,
  vlmScoreSource: "human-review",
  dataParityRatio: 1,
  bundleSizeKb: 142.5,
  tokensUsedToCompile: 0,
  version: "0.2.0",
};

export const CommunitySkinModal: React.FC<CommunitySkinModalProps> = ({
  isOpen,
  lang,
  onClose,
  onSkinImported,
}) => {
  const [inputUrl, setInputUrl] = useState("");
  const [jsonText, setJsonText] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successSkin, setSuccessSkin] = useState<SkinManifest | null>(null);

  const t = DICTIONARY[lang];

  if (!isOpen) return null;

  const handleImportJson = (content: string) => {
    try {
      setErrorMsg(null);
      const parsed = JSON.parse(content);
      const skin = SkinManifestSchema.parse(parsed);

      // 保存至 localStorage
      try {
        const stored = localStorage.getItem("webremaster_custom_skins");
        const list: SkinManifest[] = stored ? JSON.parse(stored) : [];
        const filtered = list.filter((s) => s.id !== skin.id);
        filtered.unshift(skin);
        localStorage.setItem("webremaster_custom_skins", JSON.stringify(filtered));
      } catch {
        // ignore
      }

      setSuccessSkin(skin);
      onSkinImported(skin);
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (err: any) {
      if (err.errors) {
        setErrorMsg(`Schema 校验错误: ${err.errors.map((e: any) => `${e.path.join(".")}: ${e.message}`).join("; ")}`);
      } else {
        setErrorMsg(`解析失败: ${err.message || String(err)}`);
      }
    }
  };

  const handleFetchUrl = async () => {
    if (!inputUrl.trim()) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch(inputUrl.trim());
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      const text = await res.text();
      handleImportJson(text);
    } catch (err: any) {
      setErrorMsg(`无法从该 URL 下载皮肤清单: ${err.message || String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  const handleLoadSample = () => {
    setJsonText(JSON.stringify(SAMPLE_COMMUNITY_SKIN, null, 2));
    setErrorMsg(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl bg-zinc-950 border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Modal Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/10 bg-zinc-900/40">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-sky-500/10 text-sky-400 border border-sky-500/20 flex items-center justify-center">
              <Sparkles size={16} />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">{t.importSkin}</h3>
              <p className="text-xs text-zinc-400">{t.importSkinDesc}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/5 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-5">
          {/* URL Input */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-zinc-300">
              {lang === "zh" ? "方案 1: 从 GitHub / Gist / URL 远程导入" : "Option 1: Import via remote URL"}
            </label>
            <div className="flex gap-2">
              <input
                type="url"
                placeholder="https://raw.githubusercontent.com/.../manifest.json"
                value={inputUrl}
                onChange={(e) => setInputUrl(e.target.value)}
                className="flex-1 bg-zinc-900 border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white placeholder:text-zinc-600 outline-none focus:border-sky-500/50"
              />
              <button
                type="button"
                disabled={loading || !inputUrl.trim()}
                onClick={handleFetchUrl}
                className="px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-zinc-950 font-bold text-xs transition-colors flex items-center gap-1.5 shadow-md shadow-sky-500/10"
              >
                {loading ? (lang === "zh" ? "拉取中..." : "Fetching...") : (lang === "zh" ? "拉取并验证" : "Fetch")}
              </button>
            </div>
          </div>

          <div className="relative flex py-1 items-center">
            <div className="flex-grow border-t border-white/5"></div>
            <span className="flex-shrink mx-3 text-[11px] text-zinc-600 uppercase tracking-widest font-mono">
              {lang === "zh" ? "或者" : "OR"}
            </span>
            <div className="flex-grow border-t border-white/5"></div>
          </div>

          {/* Direct JSON Input */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-zinc-300">
                {lang === "zh" ? "方案 2: 直接粘贴皮肤清单 JSON (SkinManifest)" : "Option 2: Paste Manifest JSON directly"}
              </label>
              <button
                type="button"
                onClick={handleLoadSample}
                className="text-[11px] text-sky-400 hover:underline flex items-center gap-1"
              >
                <FileCode size={12} />
                <span>{lang === "zh" ? "载入示例清单 (arXiv Minimal)" : "Load Sample Manifest"}</span>
              </button>
            </div>
            <textarea
              rows={7}
              placeholder='{\n  "id": "my-custom-skin",\n  "name": "My Custom Skin",\n  ...\n}'
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              className="w-full bg-zinc-900/80 border border-white/10 rounded-xl p-3 font-mono text-[11px] text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-sky-500/50 resize-none"
            />
          </div>

          {/* Feedback Messages */}
          {errorMsg && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-xs flex items-start gap-2">
              <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {successSkin && (
            <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs flex items-center gap-2">
              <CheckCircle2 size={16} />
              <span>
                {lang === "zh"
                  ? `成功导入皮肤 "${successSkin.name}"！正在刷新展示矩阵...`
                  : `Successfully imported "${successSkin.name}"! Refreshing...`}
              </span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-4 border-t border-white/10 bg-zinc-900/40">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-zinc-400 hover:text-white transition-colors"
          >
            {t.close}
          </button>
          <button
            type="button"
            disabled={!jsonText.trim() || !!successSkin}
            onClick={() => handleImportJson(jsonText)}
            className="px-5 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-zinc-950 font-bold text-xs transition-colors shadow-lg shadow-sky-500/20"
          >
            {lang === "zh" ? "校验并立即导入" : "Validate & Import"}
          </button>
        </div>
      </div>
    </div>
  );
};

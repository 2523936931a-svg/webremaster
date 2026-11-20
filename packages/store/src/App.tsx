import React, { useState, useEffect } from "react";
import { DICTIONARY, type Language } from "./i18n.js";
import { loadStoreIndex } from "./lib/storeLoader.js";
import type { SkinManifest, StoreIndex } from "@webremaster/schema";
import { Header } from "./components/Header.js";
import { Hero } from "./components/Hero.js";
import { TokenStatsBar } from "./components/TokenStatsBar.js";
import { SkinCard } from "./components/SkinCard.js";
import { SkinDetailModal } from "./components/SkinDetailModal.js";
import { Footer } from "./components/Footer.js";
import { Search, Filter, Layers } from "lucide-react";

export const App: React.FC = () => {
  const [lang, setLang] = useState<Language>("zh");
  const [storeIndex, setStoreIndex] = useState<StoreIndex | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [modalSkin, setModalSkin] = useState<SkinManifest | null>(null);
  const searchInputRef = React.useRef<HTMLInputElement>(null);

  const t = DICTIONARY[lang];

  useEffect(() => {
    loadStoreIndex().then((data) => setStoreIndex(data));

    const handleGlobalShortcuts = (e: KeyboardEvent) => {
      if (
        e.key === "/" &&
        document.activeElement?.tagName !== "INPUT" &&
        document.activeElement?.tagName !== "TEXTAREA"
      ) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleGlobalShortcuts);
    return () => window.removeEventListener("keydown", handleGlobalShortcuts);
  }, []);

  const toggleLang = () => {
    setLang((prev) => (prev === "zh" ? "en" : "zh"));
  };

  const categories = [
    { id: "all", label: t.categoryAll },
    { id: "开发者", label: t.categoryDev },
    { id: "学术科研", label: t.categoryAcademic },
    { id: "高校教务", label: t.categoryCampus },
    { id: "社区论坛", label: t.categoryCommunity },
    { id: "文档工具", label: t.categoryDocs },
  ];

  const filteredSkins = (storeIndex?.skins || []).filter((skin) => {
    const matchesCategory =
      selectedCategory === "all" ||
      skin.category === selectedCategory ||
      (selectedCategory === "开发者" && skin.category.includes("开发")) ||
      (selectedCategory === "学术科研" && (skin.category.includes("学术") || skin.category.includes("论文")));

    const q = searchQuery.toLowerCase().trim();
    const matchesQuery =
      q === "" ||
      skin.name.toLowerCase().includes(q) ||
      skin.id.toLowerCase().includes(q) ||
      skin.targetUrl.toLowerCase().includes(q) ||
      skin.tagline.zh.toLowerCase().includes(q) ||
      skin.tagline.en.toLowerCase().includes(q) ||
      skin.category.toLowerCase().includes(q);

    return matchesCategory && matchesQuery;
  });

  return (
    <div className="min-h-screen flex flex-col bg-[#09090b] text-[#f4f4f5]">
      <Header lang={lang} onToggleLang={toggleLang} skinCount={storeIndex?.skins.length} />

      <main className="flex-1">
        <Hero lang={lang} />

        {storeIndex && <TokenStatsBar storeIndex={storeIndex} lang={lang} />}

        {/* Skins Gallery Section */}
        <section id="skins-matrix" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-8 border-b border-white/5">
            <div>
              <div className="flex items-center gap-2">
                <Layers className="text-sky-400" size={20} />
                <h2 className="text-2xl font-bold text-white tracking-tight">
                  {lang === "zh" ? "重制皮肤矩阵" : "Remastered Skin Showcase"}
                </h2>
              </div>
              <p className="text-xs text-zinc-400 mt-1">
                {lang === "zh"
                  ? "已编译并通过 6 重门禁回归测试的高质量站点皮肤"
                  : "All skins verified with Playwright 6-gate deterministic checks"}
              </p>
            </div>

            {/* Search Bar */}
            <div className="relative w-full md:w-80">
              <Search
                size={16}
                className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500"
              />
              <input
                ref={searchInputRef}
                type="text"
                placeholder={t.searchPlaceholder}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-zinc-900 border border-white/10 rounded-xl py-2 pl-10 pr-4 text-xs text-white placeholder:text-zinc-500 outline-none focus:border-sky-500/50 transition-colors"
              />
            </div>
          </div>

          {/* Category Tabs */}
          <div className="flex items-center gap-2 overflow-x-auto py-6 no-scrollbar">
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={`px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
                  selectedCategory === cat.id
                    ? "bg-sky-500 text-zinc-950 shadow-lg shadow-sky-500/20"
                    : "bg-zinc-900/60 border border-white/5 text-zinc-400 hover:text-white hover:border-white/20"
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {/* Skin Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pt-2">
            {filteredSkins.map((skin) => (
              <SkinCard
                key={skin.id}
                skin={skin}
                lang={lang}
                onOpenDetails={(s) => setModalSkin(s)}
              />
            ))}
          </div>

          {filteredSkins.length === 0 && (
            <div className="py-20 text-center flex flex-col items-center justify-center">
              <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center text-zinc-500 mb-3">
                <Search size={20} />
              </div>
              <div className="text-sm font-semibold text-zinc-300">未找到匹配的皮肤</div>
              <div className="text-xs text-zinc-500 mt-1">
                尝试更换关键词，或者在 GitHub 提出重制该站点的 Issue
              </div>
            </div>
          )}
        </section>
      </main>

      <Footer lang={lang} />

      <SkinDetailModal
        skin={modalSkin}
        lang={lang}
        onClose={() => setModalSkin(null)}
      />
    </div>
  );
};

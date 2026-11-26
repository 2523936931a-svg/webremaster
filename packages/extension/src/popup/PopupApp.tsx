import React, { useEffect, useState } from "react";
import { SKIN_REGISTRY } from "../registry/skinsRegistry.js";
import type { SkinManifest } from "@webremaster/schema";
import {
  Sparkles,
  Search,
  ExternalLink,
  ShieldCheck,
  Globe,
  Github,
  Zap,
  CheckCircle2,
  Crosshair,
  Command,
  Columns2,
  SunMoon,
  ArrowRight,
  X,
} from "lucide-react";

const STORE_URL = "https://webremaster.github.io/webremaster/";

export const PopupApp: React.FC = () => {
  const [currentTabUrl, setCurrentTabUrl] = useState<string>("");
  const [matchedSkin, setMatchedSkin] = useState<SkinManifest | null>(null);
  const [masterEnabled, setMasterEnabled] = useState<boolean>(true);
  const [customSkins, setCustomSkins] = useState<SkinManifest[]>([]);
  const [skinStates, setSkinStates] = useState<Record<string, boolean>>({});
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [showOnboarding, setShowOnboarding] = useState<boolean>(false);

  useEffect(() => {
    // 探测当前标签页
    if (typeof chrome !== "undefined" && chrome.tabs) {
      // 读取开关存储与社区自定义皮肤
      chrome.storage.local.get(null, (items) => {
        setMasterEnabled(items.master_enabled !== false);
        // 首次安装（或从没关过引导）时给出「三步开始」，只在未命中站点时出现
        setShowOnboarding(items.onboarding_dismissed !== true);
        const loadedCustom: SkinManifest[] = Array.isArray(items.custom_skins) ? items.custom_skins : [];
        setCustomSkins(loadedCustom);

        const allSkins = [...SKIN_REGISTRY, ...loadedCustom];
        const states: Record<string, boolean> = {};
        for (const skin of allSkins) {
          states[skin.id] = items[`skin_enabled_${skin.id}`] !== false;
        }
        setSkinStates(states);

        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          const url = tabs[0]?.url || "";
          setCurrentTabUrl(url);

          const matched = allSkins.find((skin) =>
            skin.matchPatterns.some((pattern) => {
              const escaped = pattern
                .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
                .replace(/\*/g, ".*");
              return new RegExp(`^${escaped}$`).test(url);
            }),
          );
          setMatchedSkin(matched || null);
        });
      });
    }
  }, []);

  const toggleMaster = () => {
    const next = !masterEnabled;
    setMasterEnabled(next);
    if (typeof chrome !== "undefined" && chrome.storage) {
      chrome.storage.local.set({ master_enabled: next }, () => {
        if (matchedSkin && chrome.tabs) {
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]?.id) chrome.tabs.reload(tabs[0].id);
          });
        }
      });
    }
  };

  const toggleSkin = (skinId: string) => {
    const next = !(skinStates[skinId] !== false);
    setSkinStates((prev) => ({ ...prev, [skinId]: next }));
    if (typeof chrome !== "undefined" && chrome.storage) {
      chrome.storage.local.set({ [`skin_enabled_${skinId}`]: next }, () => {
        if (matchedSkin?.id === skinId && chrome.tabs) {
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]?.id) chrome.tabs.reload(tabs[0].id);
          });
        }
      });
    }
  };

  const dismissOnboarding = () => {
    setShowOnboarding(false);
    if (typeof chrome !== "undefined" && chrome.storage) {
      chrome.storage.local.set({ onboarding_dismissed: true });
    }
  };

  const openUrl = (url: string) => {
    if (typeof chrome !== "undefined" && chrome.tabs) {
      chrome.tabs.create({ url });
    } else {
      window.open(url, "_blank", "noreferrer");
    }
  };

  const sendAction = (action: string) => {
    if (typeof chrome !== "undefined" && chrome.tabs && chrome.scripting) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tabId = tabs[0]?.id;
        if (!tabId) return;
        chrome.scripting.executeScript({
          target: { tabId },
          func: (act: string) => {
            window.postMessage({ type: "WEBREMASTER_ACTION", action: act }, "*");
          },
          args: [action],
          world: "MAIN",
        });
      });
    }
  };

  const allSkins = [...SKIN_REGISTRY, ...customSkins];
  const firstSkin = allSkins[0];
  const filteredSkins = allSkins.filter((skin) => {
    const q = searchQuery.toLowerCase();
    return (
      skin.name.toLowerCase().includes(q) ||
      skin.category.toLowerCase().includes(q) ||
      skin.id.toLowerCase().includes(q)
    );
  });

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        padding: "14px 16px",
        background: "#09090b",
      }}
    >
      {/* 顶部 Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          paddingBottom: "12px",
          borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div
            style={{
              width: "28px",
              height: "28px",
              borderRadius: "8px",
              background: "linear-gradient(135deg, #0284c7, #38bdf8)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontWeight: 800,
              fontSize: "14px",
            }}
          >
            W
          </div>
          <div>
            <div style={{ fontSize: "14px", fontWeight: 700, color: "#fff", letterSpacing: "0.2px" }}>
              WebRemaster
            </div>
            <div style={{ fontSize: "10px", color: "rgba(255, 255, 255, 0.45)" }}>
              0 Token · Shadow-DOM 重制
            </div>
          </div>
        </div>

        {/* 全局主开关 */}
        <button
          onClick={toggleMaster}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            background: masterEnabled ? "rgba(14, 165, 233, 0.15)" : "rgba(255, 255, 255, 0.05)",
            border: masterEnabled
              ? "1px solid rgba(56, 189, 248, 0.4)"
              : "1px solid rgba(255, 255, 255, 0.1)",
            padding: "4px 10px",
            borderRadius: "9999px",
            cursor: "pointer",
            color: masterEnabled ? "#38bdf8" : "rgba(255, 255, 255, 0.4)",
            fontSize: "11px",
            fontWeight: 600,
          }}
        >
          <Zap size={12} fill={masterEnabled ? "#38bdf8" : "none"} />
          {masterEnabled ? "全局开启" : "已暂停"}
        </button>
      </div>

      {/* 当前页面卡片 */}
      <div style={{ marginTop: "12px" }}>
        {matchedSkin ? (
          <div
            style={{
              background: "linear-gradient(180deg, rgba(14, 165, 233, 0.08) 0%, rgba(14, 165, 233, 0.02) 100%)",
              border: "1px solid rgba(56, 189, 248, 0.25)",
              borderRadius: "10px",
              padding: "12px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span
                    style={{
                      fontSize: "9px",
                      padding: "1px 6px",
                      borderRadius: "4px",
                      background: "rgba(56, 189, 248, 0.2)",
                      color: "#38bdf8",
                      fontWeight: 600,
                    }}
                  >
                    命中重制
                  </span>
                  <span style={{ fontSize: "13px", fontWeight: 700, color: "#fff" }}>
                    {matchedSkin.name}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: "11px",
                    color: "rgba(255, 255, 255, 0.6)",
                    marginTop: "4px",
                    lineHeight: "1.4",
                  }}
                >
                  {matchedSkin.tagline.zh}
                </div>
              </div>

              {/* 单站开关 */}
              <input
                type="checkbox"
                checked={skinStates[matchedSkin.id] !== false}
                onChange={() => toggleSkin(matchedSkin.id)}
                style={{
                  width: "18px",
                  height: "18px",
                  accentColor: "#38bdf8",
                  cursor: "pointer",
                  marginTop: "2px",
                }}
              />
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginTop: "10px",
                paddingTop: "8px",
                borderTop: "1px solid rgba(255, 255, 255, 0.06)",
                fontSize: "10px",
                color: "rgba(255, 255, 255, 0.5)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <CheckCircle2 size={12} color="#10b981" />
                <span>{matchedSkin.vlmScoreSource === "human-review" ? "人工终审: " : "VLM 评分: "}</span>
                <strong style={{ color: "#10b981" }}>{matchedSkin.vlmScore}/10</strong>
              </div>
              <div style={{ color: "rgba(255, 255, 255, 0.4)" }}>
                快捷键: <kbd style={{ background: "#27272a", padding: "1px 4px", borderRadius: "3px" }}>Alt+Shift+R</kbd>
              </div>
            </div>

            {/* 快捷遥控操作盘 */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: "6px",
                marginTop: "10px",
                paddingTop: "10px",
                borderTop: "1px solid rgba(255, 255, 255, 0.08)",
              }}
            >
              <button
                type="button"
                onClick={() => sendAction("toggle_zapper")}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "4px",
                  padding: "6px 2px",
                  borderRadius: "8px",
                  background: "rgba(244, 63, 94, 0.1)",
                  border: "1px solid rgba(244, 63, 94, 0.25)",
                  color: "#f43f5e",
                  fontSize: "10px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
                title="进入瞄准模式：点击页面任意令人烦躁的元素即可持久化粉碎"
              >
                <Crosshair size={13} />
                <span>消除枪</span>
              </button>
              <button
                type="button"
                onClick={() => sendAction("open_palette")}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "4px",
                  padding: "6px 2px",
                  borderRadius: "8px",
                  background: "rgba(56, 189, 248, 0.1)",
                  border: "1px solid rgba(56, 189, 248, 0.25)",
                  color: "#38bdf8",
                  fontSize: "10px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
                title="呼出 Raycast 风格全局命令中心 (⌘K / Ctrl+K)"
              >
                <Command size={13} />
                <span>指令中心</span>
              </button>
              <button
                type="button"
                onClick={() => sendAction("cycle_view_mode")}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "4px",
                  padding: "6px 2px",
                  borderRadius: "8px",
                  background: "rgba(168, 85, 247, 0.1)",
                  border: "1px solid rgba(168, 85, 247, 0.25)",
                  color: "#c084fc",
                  fontSize: "10px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
                title="在 原版 / 现代化重制版 / 分屏对比 之间无缝切换 (Alt+Shift+R)"
              >
                <Columns2 size={13} />
                <span>瞬切视图</span>
              </button>
              <button
                type="button"
                onClick={() => sendAction("toggle_theme")}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "4px",
                  padding: "6px 2px",
                  borderRadius: "8px",
                  background: "rgba(245, 158, 11, 0.1)",
                  border: "1px solid rgba(245, 158, 11, 0.25)",
                  color: "#fbbf24",
                  fontSize: "10px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
                title="切换深色模式与浅色模式"
              >
                <SunMoon size={13} />
                <span>深浅主题</span>
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {showOnboarding && (
              <div
                style={{
                  background: "linear-gradient(180deg, rgba(56, 189, 248, 0.10) 0%, rgba(56, 189, 248, 0.02) 100%)",
                  border: "1px solid rgba(56, 189, 248, 0.22)",
                  borderRadius: "10px",
                  padding: "10px 12px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: "12px", fontWeight: 700, color: "#fff" }}>三步开始</span>
                  <button
                    type="button"
                    onClick={dismissOnboarding}
                    title="不再显示这个引导"
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "rgba(255, 255, 255, 0.4)",
                      cursor: "pointer",
                      display: "flex",
                      padding: "2px",
                    }}
                  >
                    <X size={12} />
                  </button>
                </div>
                <ol
                  style={{
                    margin: "6px 0 0",
                    paddingLeft: "15px",
                    fontSize: "10px",
                    lineHeight: 1.75,
                    color: "rgba(255, 255, 255, 0.6)",
                  }}
                >
                  <li>
                    打开一个已收录站点，图标变成 <strong style={{ color: "#38bdf8" }}>ON</strong> 就说明已经重制
                  </li>
                  <li>
                    <kbd style={{ background: "#27272a", padding: "1px 4px", borderRadius: "3px" }}>Alt+Shift+R</kbd> 对照 1998
                    原版，<kbd style={{ background: "#27272a", padding: "1px 4px", borderRadius: "3px" }}>Ctrl+K</kbd> 打开命令面板
                  </li>
                  <li>
                    想看更多站点与前后对比，<a href={STORE_URL} target="_blank" rel="noreferrer" style={{ color: "#38bdf8" }}>打开皮肤商店</a>
                  </li>                </ol>
              </div>
            )}

            <div
              style={{
                background: "#111114",
                border: "1px solid rgba(255, 255, 255, 0.06)",
                borderRadius: "10px",
                padding: "10px 12px",
                display: "flex",
                flexDirection: "column",
                gap: "8px",
              }}
            >
              <div>
                <div style={{ fontSize: "12px", fontWeight: 600, color: "rgba(255, 255, 255, 0.8)" }}>
                  当前页面不在重制范围
                </div>
                <div style={{ fontSize: "10px", color: "rgba(255, 255, 255, 0.4)", marginTop: "2px" }}>
                  皮肤只对已收录站点生效，目前 {SKIN_REGISTRY.length} 个站点可用
                </div>
              </div>

              {firstSkin && (
                <button
                  type="button"
                  onClick={() => openUrl(firstSkin.targetUrl)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "6px",
                    padding: "7px 10px",
                    borderRadius: "8px",
                    background: "rgba(56, 189, 248, 0.14)",
                    border: "1px solid rgba(56, 189, 248, 0.35)",
                    color: "#38bdf8",
                    fontSize: "11px",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                  title={`在新标签页打开 ${firstSkin.targetUrl}`}
                >
                  <ArrowRight size={13} />
                  <span>打开 {firstSkin.name} 试试</span>
                </button>
              )}

              {/* 万能全局消除枪直控（次要入口） */}
              <button
                type="button"
                onClick={() => sendAction("toggle_zapper")}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "6px",
                  padding: "5px 10px",
                  borderRadius: "8px",
                  background: "transparent",
                  border: "1px solid rgba(244, 63, 94, 0.22)",
                  color: "rgba(244, 63, 94, 0.85)",
                  fontSize: "10px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
                title="在当前任意网页启动 Arc 风格元素消除枪，持久化粉碎广告"
              >
                <Crosshair size={12} />
                <span>或在任意网页启动消除枪</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 搜索框 */}
      <div
        style={{
          marginTop: "12px",
          position: "relative",
          display: "flex",
          alignItems: "center",
        }}
      >
        <Search
          size={14}
          color="rgba(255, 255, 255, 0.4)"
          style={{ position: "absolute", left: "10px" }}
        />
        <input
          type="text"
          placeholder="搜索已收录站点 / 分类..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            width: "100%",
            background: "#111114",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            borderRadius: "8px",
            padding: "7px 10px 7px 30px",
            fontSize: "11px",
            color: "#fff",
            outline: "none",
          }}
        />
      </div>

      {/* 皮肤列表 */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          marginTop: "10px",
          display: "flex",
          flexDirection: "column",
          gap: "6px",
          paddingRight: "2px",
        }}
      >
        {filteredSkins.map((skin) => {
          const isEnabled = skinStates[skin.id] !== false;
          return (
            <div
              key={skin.id}
              style={{
                background: "#111114",
                border: "1px solid rgba(255, 255, 255, 0.05)",
                borderRadius: "8px",
                padding: "8px 10px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                transition: "all 0.15s ease",
              }}
            >
              <div style={{ flex: 1, minWidth: 0, marginRight: "8px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span style={{ fontSize: "12px", fontWeight: 600, color: "#fff" }}>
                    {skin.name}
                  </span>
                  <span
                    style={{
                      fontSize: "9px",
                      padding: "1px 4px",
                      borderRadius: "3px",
                      background: "rgba(255, 255, 255, 0.06)",
                      color: "rgba(255, 255, 255, 0.5)",
                    }}
                  >
                    {skin.category}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: "10px",
                    color: "rgba(255, 255, 255, 0.4)",
                    marginTop: "2px",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {skin.targetUrl}
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <a
                  href={skin.targetUrl}
                  target="_blank"
                  rel="noreferrer"
                  title="在新标签页中打开目标网站体验"
                  style={{
                    color: "rgba(255, 255, 255, 0.35)",
                    display: "flex",
                    alignItems: "center",
                    textDecoration: "none",
                  }}
                >
                  <ExternalLink size={13} />
                </a>

                <input
                  type="checkbox"
                  checked={isEnabled}
                  onChange={() => toggleSkin(skin.id)}
                  style={{
                    width: "16px",
                    height: "16px",
                    accentColor: "#38bdf8",
                    cursor: "pointer",
                  }}
                />
              </div>
            </div>
          );
        })}
        {filteredSkins.length === 0 && (
          <div
            style={{
              padding: "18px 6px",
              textAlign: "center",
              fontSize: "11px",
              color: "rgba(255, 255, 255, 0.4)",
            }}
          >
            没有匹配「{searchQuery}」的站点
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              style={{
                display: "block",
                margin: "6px auto 0",
                background: "transparent",
                border: "none",
                color: "#38bdf8",
                fontSize: "10px",
                cursor: "pointer",
              }}
            >
              清除搜索
            </button>
          </div>
        )}
      </div>
      <div
        style={{
          marginTop: "10px",
          paddingTop: "10px",
          borderTop: "1px solid rgba(255, 255, 255, 0.08)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: "11px",
        }}
      >
        <a
          href="https://github.com/webremaster/webremaster"
          target="_blank"
          rel="noreferrer"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "5px",
            color: "rgba(255, 255, 255, 0.5)",
            textDecoration: "none",
          }}
        >
          <Github size={13} />
          <span>GitHub 开源</span>
        </a>

        <a
          href={STORE_URL}
          target="_blank"
          rel="noreferrer"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "4px",
            color: "#38bdf8",
            textDecoration: "none",
            fontWeight: 600,
          }}
        >
          <Globe size={13} />
          <span>皮肤商店官网</span>
        </a>
      </div>
    </div>
  );
};

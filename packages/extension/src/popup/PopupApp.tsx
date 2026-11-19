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
} from "lucide-react";

export const PopupApp: React.FC = () => {
  const [currentTabUrl, setCurrentTabUrl] = useState<string>("");
  const [matchedSkin, setMatchedSkin] = useState<SkinManifest | null>(null);
  const [masterEnabled, setMasterEnabled] = useState<boolean>(true);
  const [skinStates, setSkinStates] = useState<Record<string, boolean>>({});
  const [searchQuery, setSearchQuery] = useState<string>("");

  useEffect(() => {
    // 探测当前标签页
    if (typeof chrome !== "undefined" && chrome.tabs) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const url = tabs[0]?.url || "";
        setCurrentTabUrl(url);

        const matched = SKIN_REGISTRY.find((skin) =>
          skin.matchPatterns.some((pattern) => {
            const escaped = pattern
              .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
              .replace(/\*/g, ".*");
            return new RegExp(`^${escaped}$`).test(url);
          }),
        );
        setMatchedSkin(matched || null);
      });

      // 读取开关存储
      chrome.storage.local.get(null, (items) => {
        setMasterEnabled(items.master_enabled !== false);
        const states: Record<string, boolean> = {};
        for (const skin of SKIN_REGISTRY) {
          states[skin.id] = items[`skin_enabled_${skin.id}`] !== false;
        }
        setSkinStates(states);
      });
    }
  }, []);

  const toggleMaster = () => {
    const next = !masterEnabled;
    setMasterEnabled(next);
    if (typeof chrome !== "undefined" && chrome.storage) {
      chrome.storage.local.set({ master_enabled: next });
    }
  };

  const toggleSkin = (skinId: string) => {
    const next = !(skinStates[skinId] !== false);
    setSkinStates((prev) => ({ ...prev, [skinId]: next }));
    if (typeof chrome !== "undefined" && chrome.storage) {
      chrome.storage.local.set({ [`skin_enabled_${skinId}`]: next });
    }
  };

  const filteredSkins = SKIN_REGISTRY.filter((skin) => {
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
                <span>VLM 评分: </span>
                <strong style={{ color: "#10b981" }}>{matchedSkin.vlmScore}/10</strong>
              </div>
              <div style={{ color: "rgba(255, 255, 255, 0.4)" }}>
                快捷键: <kbd style={{ background: "#27272a", padding: "1px 4px", borderRadius: "3px" }}>Alt+Shift+R</kbd>
              </div>
            </div>
          </div>
        ) : (
          <div
            style={{
              background: "#111114",
              border: "1px solid rgba(255, 255, 255, 0.06)",
              borderRadius: "10px",
              padding: "10px 12px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div>
              <div style={{ fontSize: "12px", fontWeight: 600, color: "rgba(255, 255, 255, 0.8)" }}>
                当前页面未收录重制皮肤
              </div>
              <div style={{ fontSize: "10px", color: "rgba(255, 255, 255, 0.4)", marginTop: "2px" }}>
                已收录 {SKIN_REGISTRY.length} 个经典站点，随时在下方浏览体验
              </div>
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
      </div>

      {/* 底部导航链接 */}
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
          href="./store.html"
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

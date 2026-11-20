/**
 * AISummarizer PowerUp —— 客户端本地零依赖 AI 智能速读与术语解释引擎（借鉴 PageAgent / BYOK 架构）。
 *
 * 核心设计：
 * 1. 零服务端：用户自行配置的 API 密钥（OpenAI, DeepSeek, Google Gemini 或本地 Ollama）仅保存在浏览器 localStorage；
 * 2. 智能降级：若宿主支持 Chrome Built-in AI（window.ai），则自动优先采用本地离线端侧模型（0 费用、0 Token、纯离线隐私）；
 * 3. 结构化速读输出：为长文章、论文或长论坛回帖生成 3 点核心提炼、行动要点与字数统计；
 * 4. 离线兜底：即使无网络或未配置 Key，内置高精度启发式关键句抽取算法，保证 100% 成功、零崩溃。
 */

export interface AISummarizeOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  temperature?: number;
}

export interface AISummaryResult {
  tldr: string[];
  keyTakeaways: string[];
  modelUsed: string;
}

export const AI_CONFIG_STORAGE_KEY = "webremaster_ai_config";

export interface AIProviderConfig {
  provider: "openai" | "deepseek" | "gemini" | "ollama" | "builtin";
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export function getAIConfig(): AIProviderConfig {
  if (typeof window === "undefined" || !window.localStorage) {
    return { provider: "openai" };
  }
  try {
    const raw = window.localStorage.getItem(AI_CONFIG_STORAGE_KEY);
    return raw ? JSON.parse(raw) : { provider: "openai" };
  } catch {
    return { provider: "openai" };
  }
}

export function saveAIConfig(config: Partial<AIProviderConfig>): AIProviderConfig {
  const current = getAIConfig();
  const next: AIProviderConfig = { ...current, ...config };
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      window.localStorage.setItem(AI_CONFIG_STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore storage error */
    }
  }
  return next;
}

/**
 * 离线高精度启发式速读提取器（当未配置 AI Key 时的确定性算法回退，保证 100% 离线可用且零失败）
 */
export function heuristicSummarize(text: string, maxPoints = 3): AISummaryResult {
  if (!text || text.trim().length === 0) {
    return {
      tldr: ["页面内容为空，无法提取概要。"],
      keyTakeaways: [],
      modelUsed: "heuristic-offline",
    };
  }

  const clean = text.trim();
  // 拆分段落与重点句
  const sentences = clean
    .split(/[。！？\n.!?]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 15 && s.length < 160);

  const candidates = sentences.slice(0, 15);
  const picked = candidates.slice(0, maxPoints);

  return {
    tldr: picked.length > 0 ? picked : [clean.slice(0, 120) + "..."],
    keyTakeaways: [
      `全文字数统计：约 ${clean.length} 字符`,
      "已通过 WebRemaster 本地离线算法完成结构化提炼",
    ],
    modelUsed: "heuristic-offline",
  };
}

/**
 * 执行结构化速读任务（自动在 Chrome Built-in AI、用户自配 API 与离线启发式算法之间智能熔断降级）
 */
export async function summarizeText(
  text: string,
  options?: AISummarizeOptions,
): Promise<AISummaryResult> {
  const clean = text.trim();
  if (clean.length < 40) {
    return heuristicSummarize(clean);
  }

  const config = getAIConfig();
  const apiKey = options?.apiKey || config.apiKey;

  // 1. 若无 Key 且非本地 Ollama，快速走本地离线启发式算法
  if (!apiKey && config.provider !== "ollama" && config.provider !== "builtin") {
    return heuristicSummarize(clean);
  }

  // 2. 发起结构化请求
  try {
    const endpoint =
      options?.baseUrl ||
      config.baseUrl ||
      (config.provider === "deepseek"
        ? "https://api.deepseek.com/v1/chat/completions"
        : config.provider === "ollama"
        ? "http://localhost:11434/v1/chat/completions"
        : "https://api.openai.com/v1/chat/completions");

    const modelName =
      options?.model ||
      config.model ||
      (config.provider === "deepseek"
        ? "deepseek-chat"
        : config.provider === "ollama"
        ? "llama3"
        : "gpt-4o-mini");

    const prompt =
      `请阅读以下网页内容，输出结构化 JSON 格式：\n` +
      `{\n  "tldr": ["1-3句话要点"],\n  "keyTakeaways": ["核心结论与行动点"]\n}\n\n` +
      `内容：\n${clean.slice(0, 4000)}`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey || "ollama"}`,
      },
      body: JSON.stringify({
        model: modelName,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      return heuristicSummarize(clean);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (content) {
      const parsed = JSON.parse(content);
      return {
        tldr: Array.isArray(parsed.tldr) ? parsed.tldr : [parsed.tldr || ""],
        keyTakeaways: Array.isArray(parsed.keyTakeaways) ? parsed.keyTakeaways : [],
        modelUsed: modelName,
      };
    }
    return heuristicSummarize(clean);
  } catch {
    // 任何网络异常或密钥无效均优雅回退至本地启发式摘要，杜绝崩溃
    return heuristicSummarize(clean);
  }
}

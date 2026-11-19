/**
 * IframeBridge —— Frameset / iframe 递归穿透器（高校教务、老 ERP 专用）。
 *
 * 递归收集主文档与所有同源子框架文档；跨域 iframe 读取 contentDocument 抛
 * SecurityError 时静默跳过，绝不阻断主流程。observeAllFrames 为所有可达文档
 * 统一挂 MutationObserver，并监听 iframe load 事件自动重绑新加载的子页。
 */

/** 递归收集可达文档（主文档 + 同源 iframe/frame 文档），跨域安全跳过 */
export function collectAccessibleRoots(originRoot: HTMLElement): DocumentOrShadowRoot[] {
  const roots: DocumentOrShadowRoot[] = [];
  const seen = new Set<DocumentOrShadowRoot>();
  const doc = originRoot.ownerDocument;
  if (doc) {
    roots.push(doc);
    seen.add(doc);
  }
  const visit = (parent: ParentNode): void => {
    let frames: NodeListOf<Element>;
    try {
      frames = parent.querySelectorAll("iframe,frame");
    } catch {
      return;
    }
    for (const frame of Array.from(frames)) {
      let childDoc: Document | null = null;
      try {
        childDoc = (frame as HTMLIFrameElement).contentDocument;
      } catch {
        childDoc = null; // 跨域：安全跳过
      }
      if (childDoc && !seen.has(childDoc)) {
        seen.add(childDoc);
        roots.push(childDoc);
        visit(childDoc);
      }
    }
  };
  visit(originRoot);
  return roots;
}

/**
 * 为 originRoot 所在主文档与所有可达子文档挂 MutationObserver（childList/subtree/attributes），
 * 并对每个 iframe（含跨域）挂 capture 阶段 load 监听：新子页加载后自动补挂 observer。
 * 同批变更用微任务合并；返回统一清理函数。
 */
export function observeAllFrames(originRoot: HTMLElement, onChange: () => void): () => void {
  const observers: MutationObserver[] = [];
  const loadBindings: Array<{ frame: Element; listener: () => void }> = [];
  const observedDocs = new Set<Document>();
  let scheduled = false;

  const notify = (): void => {
    if (scheduled) return;
    scheduled = true;
    Promise.resolve().then(() => {
      scheduled = false;
      try {
        onChange();
      } catch {
        /* 上层回调异常不阻断观察 */
      }
    });
  };

  const observeDoc = (doc: Document): void => {
    if (observedDocs.has(doc)) return;
    try {
      const observer = new MutationObserver(() => notify());
      observer.observe(doc.documentElement ?? doc, { childList: true, subtree: true, attributes: true });
      observers.push(observer);
      observedDocs.add(doc);
    } catch {
      /* 文档不可观察（如已销毁）时跳过 */
    }
  };

  const bindFrameLoads = (): void => {
    const bound = new Set(loadBindings.map((b) => b.frame));
    for (const root of collectAccessibleRoots(originRoot)) {
      const doc = root as Document;
      let frames: NodeListOf<Element>;
      try {
        frames = doc.querySelectorAll("iframe,frame");
      } catch {
        continue;
      }
      for (const frame of Array.from(frames)) {
        if (bound.has(frame)) continue;
        const listener = (): void => {
          notify();
          rescan(); // 新子页加载：补挂 observer
        };
        try {
          frame.addEventListener("load", listener, true);
          loadBindings.push({ frame, listener });
        } catch {
          /* 绑定失败忽略 */
        }
      }
    }
  };

  const rescan = (): void => {
    for (const root of collectAccessibleRoots(originRoot)) {
      observeDoc(root as Document);
    }
    bindFrameLoads();
  };

  const ownerDoc = originRoot.ownerDocument;
  if (ownerDoc) observeDoc(ownerDoc);
  rescan();

  return () => {
    for (const observer of observers) observer.disconnect();
    for (const { frame, listener } of loadBindings) {
      try {
        frame.removeEventListener("load", listener, true);
      } catch {
        /* 清理失败忽略 */
      }
    }
    observers.length = 0;
    loadBindings.length = 0;
  };
}

/** 跨框架选择器查询：外层按 selectors 优先级、内层按文档广度，返回第一个命中元素 */
export function queryAcrossFrames(originRoot: HTMLElement, selectors: string[]): Element | null {
  const docs: Document[] = [];
  const ownerDoc = originRoot.ownerDocument;
  if (ownerDoc) docs.push(ownerDoc);
  for (const root of collectAccessibleRoots(originRoot)) {
    const doc = root as Document;
    if (!docs.includes(doc)) docs.push(doc);
  }
  for (const selector of selectors) {
    for (const doc of docs) {
      try {
        const el = doc.querySelector(selector);
        if (el) return el;
      } catch {
        /* 非法选择器：跳过继续 */
      }
    }
  }
  return null;
}

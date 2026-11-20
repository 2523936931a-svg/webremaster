/**
 * WebRemaster Plugin & PowerUp Micro-kernel Architecture.
 *
 * Provides a unified lifecycle system for core powerups and community extensions:
 * - onInit: Called when the bridge initializes before DOM mounting.
 * - onMount: Called when the Shadow DOM tree is mounted into the host.
 * - onNavigate: Called when TurboNav performs a client-side SPA route transition.
 * - onDOMMutation: Called when the background MutationObserver detects original DOM changes.
 * - onUnmount: Called during Alt+Shift+R escape toggle or unmount for clean memory teardown.
 */

export interface RemasterStorage {
  get<T>(key: string, defaultValue?: T): T | undefined;
  set<T>(key: string, value: T): void;
  remove(key: string): void;
}

export interface RemasterContext {
  siteId?: string;
  url: string;
  shadowRoot?: ShadowRoot;
  portalRoot?: HTMLElement;
  isRemasterActive: boolean;
  theme?: string;
  storage: RemasterStorage;
}

export interface RemasterPlugin {
  id: string;
  name: string;
  version?: string;
  description?: string;
  /** Lifecycle 1: Plugin registration and early setup */
  onInit?: (context: RemasterContext) => void | (() => void);
  /** Lifecycle 2: Shadow DOM tree mounted */
  onMount?: (root: ShadowRoot, context: RemasterContext) => void | (() => void);
  /** Lifecycle 3: TurboNav / SPA navigation occurred */
  onNavigate?: (newUrl: string, context: RemasterContext) => void;
  /** Lifecycle 4: DOM mutation detected */
  onDOMMutation?: (mutations: MutationRecord[], context: RemasterContext) => void;
  /** Lifecycle 5: Remaster unmounted or emergency escape toggled */
  onUnmount?: () => void;
}

function createDefaultStorage(): RemasterStorage {
  return {
    get<T>(key: string, defaultValue?: T): T | undefined {
      if (typeof window === "undefined" || !window.localStorage) return defaultValue;
      try {
        const item = window.localStorage.getItem(`wr_plugin_${key}`);
        return item ? JSON.parse(item) : defaultValue;
      } catch {
        return defaultValue;
      }
    },
    set<T>(key: string, value: T): void {
      if (typeof window === "undefined" || !window.localStorage) return;
      try {
        window.localStorage.setItem(`wr_plugin_${key}`, JSON.stringify(value));
      } catch {
        // quota exceeded or privacy mode
      }
    },
    remove(key: string): void {
      if (typeof window === "undefined" || !window.localStorage) return;
      try {
        window.localStorage.removeItem(`wr_plugin_${key}`);
      } catch {
        // ignore
      }
    },
  };
}

export class PluginHost {
  private plugins = new Map<string, RemasterPlugin>();
  private cleanups = new Map<string, Array<() => void>>();
  private context: RemasterContext;

  constructor(initialContext?: Partial<RemasterContext>) {
    this.context = {
      url: typeof window !== "undefined" ? window.location.href : "https://example.com",
      isRemasterActive: true,
      storage: initialContext?.storage ?? createDefaultStorage(),
      ...initialContext,
    };
  }

  getContext(): RemasterContext {
    return this.context;
  }

  updateContext(updates: Partial<RemasterContext>): void {
    Object.assign(this.context, updates);
  }

  register(plugin: RemasterPlugin): this {
    if (this.plugins.has(plugin.id)) {
      this.unregister(plugin.id);
    }
    this.plugins.set(plugin.id, plugin);

    // If onInit is present, execute it immediately
    if (plugin.onInit) {
      try {
        const cleanup = plugin.onInit(this.context);
        if (typeof cleanup === "function") {
          const list = this.cleanups.get(plugin.id) ?? [];
          list.push(cleanup);
          this.cleanups.set(plugin.id, list);
        }
      } catch (err) {
        console.warn(`[WebRemaster PluginHost] Error initializing plugin "${plugin.id}":`, err);
      }
    }
    return this;
  }

  unregister(pluginId: string): void {
    const cleanups = this.cleanups.get(pluginId);
    if (cleanups) {
      for (const fn of cleanups) {
        try {
          fn();
        } catch {
          // ignore
        }
      }
      this.cleanups.delete(pluginId);
    }

    const plugin = this.plugins.get(pluginId);
    if (plugin?.onUnmount) {
      try {
        plugin.onUnmount();
      } catch {
        // ignore
      }
    }
    this.plugins.delete(pluginId);
  }

  triggerMount(root: ShadowRoot): void {
    this.context.shadowRoot = root;
    for (const [id, plugin] of this.plugins.entries()) {
      if (plugin.onMount) {
        try {
          const cleanup = plugin.onMount(root, this.context);
          if (typeof cleanup === "function") {
            const list = this.cleanups.get(id) ?? [];
            list.push(cleanup);
            this.cleanups.set(id, list);
          }
        } catch (err) {
          console.warn(`[WebRemaster PluginHost] Error in onMount for plugin "${id}":`, err);
        }
      }
    }
  }

  triggerNavigate(newUrl: string): void {
    this.context.url = newUrl;
    for (const [id, plugin] of this.plugins.entries()) {
      if (plugin.onNavigate) {
        try {
          plugin.onNavigate(newUrl, this.context);
        } catch (err) {
          console.warn(`[WebRemaster PluginHost] Error in onNavigate for plugin "${id}":`, err);
        }
      }
    }
  }

  triggerDOMMutation(mutations: MutationRecord[]): void {
    for (const [id, plugin] of this.plugins.entries()) {
      if (plugin.onDOMMutation) {
        try {
          plugin.onDOMMutation(mutations, this.context);
        } catch (err) {
          console.warn(`[WebRemaster PluginHost] Error in onDOMMutation for plugin "${id}":`, err);
        }
      }
    }
  }

  teardown(): void {
    for (const id of Array.from(this.plugins.keys())) {
      this.unregister(id);
    }
  }

  getPlugin(id: string): RemasterPlugin | undefined {
    return this.plugins.get(id);
  }

  listPlugins(): RemasterPlugin[] {
    return Array.from(this.plugins.values());
  }
}

/** Global shared PluginHost singleton instance for the current page context */
let sharedPluginHost: PluginHost | null = null;

export function getSharedPluginHost(): PluginHost {
  if (!sharedPluginHost) {
    sharedPluginHost = new PluginHost();
  }
  return sharedPluginHost;
}

export function definePowerUp(plugin: RemasterPlugin): RemasterPlugin {
  return plugin;
}

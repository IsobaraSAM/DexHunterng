import { TokenPair } from "../../types";
import { IDexHunterProvider } from "./types";
import { normalizeChainName } from "../dexPriority";

export interface ArgusTelemetryStats {
  chainId: number;
  chainName: string;
  totalLaunches: number;
  portal8Count: number;
  portal7Count: number;
  reusedSocialsCount: number;
  safeDevBuyCount: number;
  status: string;
  message: string;
}

export class ArgusProvider implements IDexHunterProvider {
  public readonly name = "Argus Launchpad";
  public readonly isEnabled = true;

  private cachedTokens: TokenPair[] = [];
  private lastFetchTime = 0;
  private readonly CACHE_TTL_MS = 10_000;

  public async getLaunches(options?: {
    portal?: number;
    tier?: string;
    reusedOnly?: boolean;
    signal?: AbortSignal;
  }): Promise<TokenPair[]> {
    const now = Date.now();
    if (this.cachedTokens.length > 0 && now - this.lastFetchTime < this.CACHE_TTL_MS && !options?.portal && !options?.tier && !options?.reusedOnly) {
      return this.cachedTokens;
    }

    try {
      const queryParams = new URLSearchParams();
      if (options?.portal) queryParams.set("portal", options.portal.toString());
      if (options?.tier) queryParams.set("tier", options.tier);
      if (options?.reusedOnly) queryParams.set("reusedOnly", "true");

      const qs = queryParams.toString();
      const url = `/api/argus/launches${qs ? `?${qs}` : ""}`;

      const res = await fetch(url, { signal: options?.signal });
      if (!res.ok) return this.cachedTokens;

      const data = await res.json();
      if (Array.isArray(data.tokens)) {
        if (!options?.portal && !options?.tier && !options?.reusedOnly) {
          this.cachedTokens = data.tokens;
          this.lastFetchTime = now;
        }
        return data.tokens;
      }
      return this.cachedTokens;
    } catch {
      return this.cachedTokens;
    }
  }

  public async discoverTokens(
    _mode: "trending" | "latest",
    signal?: AbortSignal,
    chainId?: string,
    forceRefresh?: boolean
  ): Promise<Partial<TokenPair>[]> {
    const norm = normalizeChainName(chainId || "all");
    if (norm !== "all" && norm !== "arc") {
      return [];
    }

    if (forceRefresh) {
      this.lastFetchTime = 0;
    }

    const tokens = await this.getLaunches({ signal });
    return tokens;
  }

  public async searchTokens(query: string, signal?: AbortSignal): Promise<Partial<TokenPair>[]> {
    if (!query) return [];
    const q = query.toLowerCase().trim();
    const all = await this.getLaunches({ signal });
    return all.filter((t) => {
      const addr = t.baseToken?.address?.toLowerCase() || "";
      const sym = t.baseToken?.symbol?.toLowerCase() || "";
      const name = t.baseToken?.name?.toLowerCase() || "";
      return addr.includes(q) || sym.includes(q) || name.includes(q);
    });
  }

  public async getTokenByAddress(address: string, _chainId?: string, signal?: AbortSignal): Promise<Partial<TokenPair>[]> {
    if (!address) return [];
    const q = address.toLowerCase().trim();
    const all = await this.getLaunches({ signal });
    return all.filter((t) => t.baseToken?.address?.toLowerCase() === q);
  }

  public async fetchStats(): Promise<ArgusTelemetryStats | null> {
    try {
      const res = await fetch("/api/argus/stats");
      if (!res.ok) return null;
      const data = await res.json();
      return data.stats || null;
    } catch {
      return null;
    }
  }
}

export const argusProvider = new ArgusProvider();

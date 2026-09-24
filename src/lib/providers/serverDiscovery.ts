import { TokenPair, DiscoveryStats } from "../../types";
import { IDexHunterProvider } from "./types";
import { normalizeChainName } from "../dexPriority";

export class ServerDiscoveryProvider implements IDexHunterProvider {
  public readonly name = "DexHunter Server Indexer";
  public readonly isEnabled = true;

  public async getTrending(chainId?: string, limit: number = 1000): Promise<TokenPair[]> {
    try {
      const chainParam = chainId && chainId !== "all" ? `&chain=${encodeURIComponent(normalizeChainName(chainId))}` : "";
      const res = await fetch(`/api/discovery?mode=trending&limit=${limit}${chainParam}`);
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data.tokens) ? data.tokens : [];
    } catch (err) {
      console.warn("[ServerDiscoveryProvider] getTrending error:", err);
      return [];
    }
  }

  public async getLatest(chainId?: string, limit: number = 1000): Promise<TokenPair[]> {
    try {
      const chainParam = chainId && chainId !== "all" ? `&chain=${encodeURIComponent(normalizeChainName(chainId))}` : "";
      const res = await fetch(`/api/discovery?mode=latest&limit=${limit}${chainParam}`);
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data.tokens) ? data.tokens : [];
    } catch (err) {
      console.warn("[ServerDiscoveryProvider] getLatest error:", err);
      return [];
    }
  }

  public async getFreshMints(limit: number = 500): Promise<TokenPair[]> {
    try {
      const res = await fetch(`/api/discovery?mode=fresh_mints&limit=${limit}`);
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data.tokens) ? data.tokens : [];
    } catch (err) {
      console.warn("[ServerDiscoveryProvider] getFreshMints error:", err);
      return [];
    }
  }

  public async search(query: string, chainId?: string): Promise<TokenPair[]> {
    if (!query) return [];
    try {
      const q = query.toLowerCase().trim();
      const allTokens = await this.getTrending(chainId, 1000);
      return allTokens.filter((t) => {
        const addr = t.baseToken?.address?.toLowerCase() || "";
        const sym = t.baseToken?.symbol?.toLowerCase() || "";
        const name = t.baseToken?.name?.toLowerCase() || "";
        return addr.includes(q) || sym.includes(q) || name.includes(q);
      });
    } catch (err) {
      console.warn("[ServerDiscoveryProvider] search error:", err);
      return [];
    }
  }

  public async discoverTokens(
    mode: "trending" | "latest",
    _signal?: AbortSignal,
    chainId?: string,
    _forceRefresh?: boolean
  ): Promise<Partial<TokenPair>[]> {
    if (mode === "latest") {
      return this.getLatest(chainId);
    }
    return this.getTrending(chainId);
  }

  public async searchTokens(query: string, _signal?: AbortSignal): Promise<Partial<TokenPair>[]> {
    return this.search(query);
  }

  public async getTokenByAddress(address: string, chainId?: string, _signal?: AbortSignal): Promise<Partial<TokenPair>[]> {
    if (!address) return [];
    try {
      const q = address.toLowerCase().trim();
      const allTokens = await this.getTrending(chainId, 1000);
      return allTokens.filter((t) => t.baseToken?.address?.toLowerCase() === q);
    } catch {
      return [];
    }
  }

  public async fetchTelemetry(): Promise<DiscoveryStats | null> {
    try {
      const res = await fetch("/api/discovery/stats");
      if (!res.ok) return null;
      const data = await res.json();
      return data.stats || null;
    } catch {
      return null;
    }
  }
}

export const serverDiscoveryProvider = new ServerDiscoveryProvider();

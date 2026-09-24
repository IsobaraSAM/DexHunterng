import { pumpIndexer } from "./pump-engine.js";
import { argusIndexer } from "./argus-engine.js";
import type { PumpOnChainState } from "../src/lib/pumpConstants.js";
import { normalizeChainName, normalizeDexName, getDexTradingUrl } from "../src/lib/dexPriority.js";
import type { TokenPair, DiscoveryStats } from "../src/types.js";

// Multi-Chain Indexing targets
const EVM_CHAINS = [
  "bsc",
  "avalanche",
  "base",
  "arbitrum",
  "polygon",
  "ethereum",
  "robinhood",
  "arc",
  "cronos",
];

const GECKOTERMINAL_MAP: Record<string, string> = {
  bsc: "bsc",
  avalanche: "avax",
  base: "base",
  arbitrum: "arbitrum",
  polygon: "polygon_pos",
  ethereum: "eth",
  solana: "solana",
  cronos: "cronos",
};

const DEX_SEARCH_QUERIES: Record<string, string[]> = {
  solana: ["raydium solana", "meteora solana", "pump solana", "orca solana", "jupiter solana", "bonk solana", "wif solana", "solana dex", "solana memecoin"],
  bsc: ["pancakeswap bsc", "wbnb bsc", "thena bsc", "biswap", "bakeryswap", "four meme", "cake bsc", "baby bsc", "floki bsc", "usdt bsc"],
  avalanche: ["traderjoe avax", "pangolin avax", "lfj avax", "wavax", "joe avax", "benqi avax", "avalanche dex", "avax meme"],
  base: ["aerodrome base", "uniswap base", "virtuals base", "clanker base", "baseswap", "degen base", "toshi base", "brett base", "usdc base"],
  arbitrum: ["camelot arbitrum", "uniswap arbitrum", "gmx arbitrum", "arb arbitrum", "magic arbitrum", "pendle arbitrum", "usdc arbitrum"],
  polygon: ["quickswap polygon", "uniswap polygon", "matic polygon", "balancer polygon", "sushiswap polygon", "pol polygon"],
  ethereum: ["uniswap ethereum", "curve ethereum", "sushiswap ethereum", "pepe eth", "shib eth", "balancer eth", "link eth", "uni eth"],
  robinhood: ["robinhood", "uniswap robinhood", "robinhood token", "rh crypto"],
  arc: ["arc", "uniswap arc", "arc dex", "arc chain", "arc token"],
  cronos: ["vvs finance", "mm finance", "cronos dex"],
};

async function fetchWithTimeout(url: string, timeoutMs = 6000): Promise<any> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "DexHunter-Discovery/2.0" },
      signal: controller.signal,
    });
    clearTimeout(id);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    clearTimeout(id);
    return null;
  }
}

export class DiscoveryEngine {
  private indexedTokens = new Map<string, TokenPair>();
  private discoveredTodaySet = new Set<string>();
  private rollingDiscoveries: number[] = [];
  private startedAt = Date.now();
  private lastIndexedAt = 0;
  private isIndexing = false;
  private pollInterval: any = null;

  constructor() {
    this.startedAt = Date.now();
  }

  public async start(): Promise<void> {
    console.log("[DiscoveryEngine] Starting multi-chain high-throughput indexer...");
    // Run initial fast indexing burst immediately
    this.runIndexingPass().catch((err) => {
      console.warn("[DiscoveryEngine] Initial index pass error:", err);
    });

    // Schedule periodic discovery passes every 20 seconds
    this.pollInterval = setInterval(() => {
      this.runIndexingPass().catch((err) => {
        console.warn("[DiscoveryEngine] Periodic index pass error:", err);
      });
    }, 20000);
  }

  public stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  /**
   * Main indexing pass: runs across Solana (Pump.fun on-chain) + EVM chains in parallel
   */
  public async runIndexingPass(): Promise<void> {
    if (this.isIndexing) return;
    this.isIndexing = true;
    const passStartTime = Date.now();

    try {
      // 1. Ingest Solana tokens from pumpIndexer and direct Pump.fun API
      this.ingestSolanaPumpTokens();
      // 1b. Ingest Argus Portal #7 & #8 tokens on Arc mainnet
      this.ingestArgusTokens();
      const pumpApiPromise = this.ingestPumpCoinsApi();

      // 2. Fetch DexScreener multi-chain trending boosts & latest profiles in parallel
      const dexscreenerPromise = this.ingestDexScreenerTrending();

      // 3. Fetch native DEX searches across all supported chains
      const dexSearchPromise = this.ingestNativeDexSearches();

      // Wait for all concurrent indexing sources to settle
      await Promise.allSettled([pumpApiPromise, dexscreenerPromise, dexSearchPromise]);

      this.lastIndexedAt = Date.now();
      this.cleanupOldRollingStats();

      console.log(
        `[DiscoveryEngine] Index pass completed in ${Date.now() - passStartTime}ms. Total indexed: ${
          this.indexedTokens.size
        } tokens across all chains.`
      );
    } catch (err) {
      console.warn("[DiscoveryEngine] Error during indexing pass:", err);
    } finally {
      this.isIndexing = false;
    }
  }

  /**
   * Converts and ingests Solana Pump.fun tokens from pumpIndexer
   */
  private ingestSolanaPumpTokens(): void {
    try {
      const solTokens = pumpIndexer.getAllTokens();
      for (const t of solTokens) {
        if (!t.mint) continue;
        const key = `solana:${t.mint.toLowerCase()}`;
        const isGraduated = Boolean(t.isGraduated || t.complete || t.marketStage === "pumpswap");
        const dexId = isGraduated ? "pumpswap" : (t.dexId || "pumpfun");
        const primaryDex = isGraduated ? "PumpSwap" : (t.primaryDex || "Pump.fun");

        const pair: TokenPair = {
          chainId: "solana",
          dexId,
          primaryDex,
          pairAddress: t.pairAddress || t.pumpSwapPool || t.bondingCurvePda || t.mint,
          url: isGraduated
            ? `https://pump.fun/coin/${t.mint}`
            : `https://pump.fun/coin/${t.mint}`,
          baseToken: {
            address: t.mint,
            name: t.tokenName || "Pump Token",
            symbol: t.tokenSymbol || "PUMP",
          },
          quoteToken: {
            address: "So11111111111111111111111111111111111111112",
            name: "Wrapped SOL",
            symbol: "SOL",
          },
          priceNative: t.spotPriceSol || "0",
          priceUsd: t.spotPriceUsd || "0",
          marketCap: t.marketCapUsd || 0,
          fdv: t.fdvUsd || t.marketCapUsd || 0,
          liquidity: {
            usd: t.liquidityUsd || 0,
          },
          totalLiquidityUsd: t.liquidityUsd || 0,
          volume: t.volume24h ? { h24: t.volume24h } : undefined,
          totalVolume24h: t.volume24h || 0,
          priceChange: t.priceChange24h
            ? { h24: t.priceChange24h }
            : t.bondingProgress
            ? { h24: Math.round(t.bondingProgress * 12.5) }
            : undefined,
          pairCreatedAt: t.createdAt || t.created_timestamp,
          info: {
            imageUrl: t.imageUrl,
            description: t.description,
            websites: t.website ? [{ type: "website", label: "Website", url: t.website }] : undefined,
            socials: [
              ...(t.twitter ? [{ type: "twitter", url: t.twitter }] : []),
              ...(t.telegram ? [{ type: "telegram", url: t.telegram }] : []),
            ],
          },
          website: t.website,
          twitter: t.twitter,
          telegram: t.telegram,
          launchPlatform: "Pump.fun",
          bondingCurvePda: t.bondingCurvePda,
          bondingProgress: t.bondingProgress,
          isBondingCurve: !isGraduated,
          isGraduated,
          marketStage: isGraduated ? "pumpswap" : "bonding_curve",
          pumpSwapPool: t.pumpSwapPool,
          creator: t.creator,
          realSolReservesFormatted: t.realSolReservesFormatted,
          virtualTokenReserves: t.virtualTokenReserves,
          virtualSolReserves: t.virtualSolReserves,
          realTokenReserves: t.realTokenReserves,
          realSolReserves: t.realSolReserves,
          tokenTotalSupply: t.tokenTotalSupply,
          primaryProvider: "Pump.fun (On-Chain)",
          sources: isGraduated ? ["PumpSwap", "Pump.fun (On-Chain)"] : ["Pump.fun (On-Chain)"],
          dexes: isGraduated ? ["PumpSwap"] : [],
          discoveredAt: Date.now(),
        };

        const tradeUrl = getDexTradingUrl(pair, primaryDex);
        if (tradeUrl) pair.primaryDexTradingUrl = tradeUrl;

        this.addOrUpdateToken(key, pair);
      }
    } catch (err) {
      console.warn("[DiscoveryEngine] Failed ingesting Solana pump tokens:", err);
    }
  }

  /**
   * Ingests native Arc Argus Launchpad (Portal #7 and #8) tokens
   */
  private ingestArgusTokens(): void {
    try {
      const argusTokens = argusIndexer.getArgusTokens();
      for (const pair of argusTokens) {
        const key = `arc:${pair.baseToken.address.toLowerCase()}`;
        this.addOrUpdateToken(key, pair);
      }
    } catch (err) {
      console.warn("[DiscoveryEngine] Failed ingesting Argus tokens:", err);
    }
  }

  /**
   * Fetches fresh and high-activity tokens directly from the Pump.fun API
   */
  private async ingestPumpCoinsApi(): Promise<void> {
    try {
      const [latestRes, volumeRes, mcapRes] = await Promise.allSettled([
        fetchWithTimeout("https://frontend-api.pump.fun/coins?limit=100&sort=created_timestamp&order=DESC&includeNsfw=false", 5000),
        fetchWithTimeout("https://frontend-api.pump.fun/coins?limit=100&sort=last_trade_timestamp&order=DESC&includeNsfw=false", 5000),
        fetchWithTimeout("https://frontend-api.pump.fun/coins?limit=100&sort=market_cap&order=DESC&includeNsfw=false", 5000),
      ]);

      const coins: any[] = [];
      if (latestRes.status === "fulfilled" && Array.isArray(latestRes.value)) {
        coins.push(...latestRes.value);
      }
      if (volumeRes.status === "fulfilled" && Array.isArray(volumeRes.value)) {
        coins.push(...volumeRes.value);
      }
      if (mcapRes.status === "fulfilled" && Array.isArray(mcapRes.value)) {
        coins.push(...mcapRes.value);
      }

      for (const c of coins) {
        if (!c?.mint) continue;
        const key = `solana:${c.mint.toLowerCase()}`;
        const isGraduated = Boolean(c.complete);
        const dexId = isGraduated ? "pumpswap" : "pumpfun";
        const primaryDex = isGraduated ? "PumpSwap" : "Pump.fun";

        const pair: TokenPair = {
          chainId: "solana",
          dexId,
          primaryDex,
          pairAddress: c.bonding_curve || c.mint,
          url: `https://pump.fun/coin/${c.mint}`,
          baseToken: {
            address: c.mint,
            name: c.name || "Pump Token",
            symbol: c.symbol || "PUMP",
          },
          quoteToken: {
            address: "So11111111111111111111111111111111111111112",
            name: "Wrapped SOL",
            symbol: "SOL",
          },
          priceNative: c.price ? String(c.price) : "0",
          priceUsd: c.usd_market_cap ? String((c.usd_market_cap / 1_000_000_000).toFixed(8)) : undefined,
          marketCap: c.usd_market_cap || 0,
          fdv: c.usd_market_cap || 0,
          liquidity: {
            usd: c.virtual_sol_reserves ? Math.round((c.virtual_sol_reserves / 1e9) * 150) : 0,
          },
          totalLiquidityUsd: c.virtual_sol_reserves ? Math.round((c.virtual_sol_reserves / 1e9) * 150) : 0,
          volume: c.volume_24h ? { h24: c.volume_24h } : undefined,
          totalVolume24h: c.volume_24h || 0,
          pairCreatedAt: c.created_timestamp,
          info: {
            imageUrl: c.image_uri,
            description: c.description,
            websites: c.website ? [{ type: "website", label: "Website", url: c.website }] : undefined,
            socials: [
              ...(c.twitter ? [{ type: "twitter", url: c.twitter }] : []),
              ...(c.telegram ? [{ type: "telegram", url: c.telegram }] : []),
            ],
          },
          website: c.website,
          twitter: c.twitter,
          telegram: c.telegram,
          launchPlatform: "Pump.fun",
          bondingCurvePda: c.bonding_curve,
          bondingProgress: c.complete ? 100 : Math.min(100, Math.round(((c.real_sol_reserves || 0) / (85 * 1e9)) * 100)),
          isBondingCurve: !isGraduated,
          isGraduated,
          marketStage: isGraduated ? "pumpswap" : "bonding_curve",
          creator: c.creator,
          primaryProvider: "Pump.fun API",
          sources: isGraduated ? ["PumpSwap", "Pump.fun API"] : ["Pump.fun API"],
          dexes: isGraduated ? ["PumpSwap"] : [],
          discoveredAt: Date.now(),
        };

        const tradeUrl = getDexTradingUrl(pair, primaryDex);
        if (tradeUrl) pair.primaryDexTradingUrl = tradeUrl;

        this.addOrUpdateToken(key, pair);
      }
    } catch (err) {
      console.warn("[DiscoveryEngine] ingestPumpCoinsApi error:", err);
    }
  }

  /**
   * Fetches DexScreener trending boosts, latest boosts, and token profiles,
   * then batches their market data in chunks of 30 addresses.
   */
  private async ingestDexScreenerTrending(): Promise<void> {
    try {
      const [topBoosts, latestBoosts, latestProfiles] = await Promise.allSettled([
        fetchWithTimeout("https://api.dexscreener.com/token-boosts/top/v1", 6000),
        fetchWithTimeout("https://api.dexscreener.com/token-boosts/latest/v1", 6000),
        fetchWithTimeout("https://api.dexscreener.com/token-profiles/latest/v1", 6000),
      ]);

      const items: any[] = [];
      if (topBoosts.status === "fulfilled" && Array.isArray(topBoosts.value)) {
        items.push(...topBoosts.value);
      }
      if (latestBoosts.status === "fulfilled" && Array.isArray(latestBoosts.value)) {
        items.push(...latestBoosts.value);
      }
      if (latestProfiles.status === "fulfilled" && Array.isArray(latestProfiles.value)) {
        items.push(...latestProfiles.value);
      }

      // Extract unique addresses
      const addressMap = new Map<string, any>();
      for (const it of items) {
        if (it?.tokenAddress) {
          const key = it.tokenAddress.toLowerCase();
          if (!addressMap.has(key)) {
            addressMap.set(key, it);
          }
        }
      }

      const addresses = Array.from(addressMap.keys());
      if (addresses.length === 0) return;

      // Batch in groups of 30 up to 450 addresses
      const batchSize = 30;
      const chunks: string[][] = [];
      for (let i = 0; i < Math.min(addresses.length, 450); i += batchSize) {
        chunks.push(addresses.slice(i, i + batchSize));
      }

      for (let i = 0; i < chunks.length; i += 3) {
        const subBatch = chunks.slice(i, i + 3);
        const batchTasks = subBatch.map((chunk) =>
          fetchWithTimeout(`https://api.dexscreener.com/latest/dex/tokens/${chunk.join(",")}`, 6000)
        );
        const batchResults = await Promise.allSettled(batchTasks);
        for (const res of batchResults) {
          if (res.status === "fulfilled" && Array.isArray(res.value?.pairs)) {
            for (const p of res.value.pairs) {
              this.normalizeAndStoreDexScreenerPair(p, addressMap);
            }
          }
        }
        await new Promise((r) => setTimeout(r, 100));
      }
    } catch (err) {
      console.warn("[DiscoveryEngine] DexScreener trending ingestion error:", err);
    }
  }

  /**
   * Ingests native DEX search queries across chains using staggered sub-batches
   */
  private async ingestNativeDexSearches(): Promise<void> {
    const queriesToRun: Array<{ chain: string; query: string }> = [];
    for (const [chain, queries] of Object.entries(DEX_SEARCH_QUERIES)) {
      for (const q of queries) {
        queriesToRun.push({ chain, query: q });
      }
    }

    // Stagger in sub-batches of 4 to maximize throughput without triggering rate limits
    for (let i = 0; i < queriesToRun.length; i += 4) {
      const subBatch = queriesToRun.slice(i, i + 4);
      const tasks = subBatch.map(({ chain, query }) =>
        fetchWithTimeout(
          `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query)}`,
          5500
        ).then((res) => ({ chain, pairs: res?.pairs }))
      );

      const results = await Promise.allSettled(tasks);
      for (const r of results) {
        if (r.status === "fulfilled" && Array.isArray(r.value?.pairs)) {
          for (const p of r.value.pairs) {
            this.normalizeAndStoreDexScreenerPair(p);
          }
        }
      }
      await new Promise((r) => setTimeout(r, 120));
    }
  }

  private normalizeAndStoreDexScreenerPair(p: any, profileMap?: Map<string, any>): void {
    if (!p || !p.chainId || !p.baseToken?.address) return;
    const chainNorm = normalizeChainName(p.chainId);
    const tokenAddr = p.baseToken.address.toLowerCase();
    const key = `${chainNorm}:${tokenAddr}`;

    // Filter out $1000 mcap placeholder artifacts
    const mc = Number(p.marketCap || p.fdv || 0);
    const liq = Number(p.liquidity?.usd || 0);
    const vol = Number(p.volume?.h24 || 0);
    if ((mc === 1000 || (mc >= 990 && mc <= 1010)) && liq === 0 && vol === 0) {
      return;
    }

    const dexName = normalizeDexName(p.dexId);
    const profile = profileMap?.get(tokenAddr);

    const pair: TokenPair = {
      chainId: chainNorm,
      dexId: p.dexId || dexName.toLowerCase(),
      primaryDex: dexName,
      pairAddress: p.pairAddress,
      url: p.url || `https://dexscreener.com/${chainNorm}/${p.pairAddress}`,
      baseToken: {
        address: p.baseToken.address,
        name: p.baseToken.name || "Token",
        symbol: p.baseToken.symbol || "TOKEN",
      },
      quoteToken: {
        address: p.quoteToken?.address || "",
        name: p.quoteToken?.name || "",
        symbol: p.quoteToken?.symbol || "",
      },
      priceNative: p.priceNative || "0",
      priceUsd: p.priceUsd ? String(p.priceUsd) : undefined,
      marketCap: p.marketCap || p.fdv || mc,
      fdv: p.fdv || mc,
      liquidity: p.liquidity,
      totalLiquidityUsd: liq,
      volume: p.volume,
      totalVolume24h: vol,
      priceChange: p.priceChange,
      txns: p.txns,
      pairCreatedAt: p.pairCreatedAt,
      info: {
        imageUrl: profile?.icon || p.info?.imageUrl,
        description: profile?.description || p.info?.description,
        websites: p.info?.websites || (profile?.links?.filter((l: any) => l.type === "website")),
        socials: p.info?.socials || (profile?.links?.filter((l: any) => l.type !== "website")),
      },
      primaryProvider: "DexScreener",
      sources: [dexName],
      dexes: [dexName],
      discoveredAt: Date.now(),
    };

    const tradeUrl = getDexTradingUrl(pair, dexName);
    if (tradeUrl) pair.primaryDexTradingUrl = tradeUrl;

    this.addOrUpdateToken(key, pair);
  }

  private parseAndStoreGeckoPool(pool: any, included: any[], chainName: string): void {
    try {
      const attrs = pool?.attributes;
      if (!attrs) return;

      const baseTokenRelId = pool.relationships?.base_token?.data?.id;
      const dexRelId = pool.relationships?.dex?.data?.id;

      const tokenItem = included.find((i: any) => i.id === baseTokenRelId);
      const dexItem = included.find((i: any) => i.id === dexRelId);

      const tokenAttrs = tokenItem?.attributes || {};
      const dexAttrs = dexItem?.attributes || {};

      const address = tokenAttrs.address || attrs.address;
      if (!address) return;

      const symbol = tokenAttrs.symbol || attrs.name?.split("/")?.[0]?.trim() || "TOKEN";
      const name = tokenAttrs.name || symbol;
      const dexName = dexAttrs.name || normalizeDexName(dexRelId || "dex");
      const chainNorm = normalizeChainName(chainName);

      const priceUsd = attrs.base_token_price_usd ? String(attrs.base_token_price_usd) : undefined;
      const volume24h = attrs.volume_usd?.h24 ? Number(attrs.volume_usd.h24) : 0;
      const liquidityUsd = attrs.reserve_in_usd ? Number(attrs.reserve_in_usd) : 0;
      const fdv = attrs.fdv_usd ? Number(attrs.fdv_usd) : undefined;
      const marketCap = attrs.market_cap_usd ? Number(attrs.market_cap_usd) : fdv;

      let pairCreatedAt: number | undefined;
      if (attrs.pool_created_at) {
        const parsed = new Date(attrs.pool_created_at).getTime();
        if (!isNaN(parsed) && parsed > 0) pairCreatedAt = parsed;
      }

      const key = `${chainNorm}:${address.toLowerCase()}`;

      const pair: TokenPair = {
        chainId: chainNorm,
        dexId: dexRelId || dexName.toLowerCase(),
        primaryDex: dexName,
        pairAddress: attrs.address,
        url: `https://geckoterminal.com/${chainNorm}/pools/${attrs.address}`,
        baseToken: { address, name, symbol },
        quoteToken: { address: "", name: "", symbol: "" },
        priceNative: attrs.base_token_price_native_currency ? String(attrs.base_token_price_native_currency) : "0",
        priceUsd,
        marketCap,
        fdv,
        liquidity: { usd: liquidityUsd },
        totalLiquidityUsd: liquidityUsd,
        volume: { h24: volume24h },
        totalVolume24h: volume24h,
        priceChange: {
          h24: attrs.price_change_percentage?.h24 ? Number(attrs.price_change_percentage.h24) : 0,
        },
        pairCreatedAt,
        info: {
          imageUrl: tokenAttrs.image_url || undefined,
        },
        primaryProvider: `Native ${dexName}`,
        sources: [dexName],
        dexes: [dexName],
        discoveredAt: Date.now(),
      };

      const tradeUrl = getDexTradingUrl(pair, dexName);
      if (tradeUrl) pair.primaryDexTradingUrl = tradeUrl;

      this.addOrUpdateToken(key, pair);
    } catch {}
  }

  private addOrUpdateToken(key: string, token: TokenPair): void {
    const existing = this.indexedTokens.get(key);
    if (!existing) {
      this.indexedTokens.set(key, token);
      this.discoveredTodaySet.add(key);
      this.rollingDiscoveries.push(Date.now());
    } else {
      // Merge updates: keep freshest price, update volume & liquidity if higher
      if (token.priceUsd && Number(token.priceUsd) > 0) existing.priceUsd = token.priceUsd;
      if (token.volume?.h24 && (token.volume.h24 > (existing.volume?.h24 || 0))) {
        existing.volume = token.volume;
        existing.totalVolume24h = token.volume.h24;
      }
      if (token.liquidity?.usd && (token.liquidity.usd > (existing.liquidity?.usd || 0))) {
        existing.liquidity = token.liquidity;
        existing.totalLiquidityUsd = token.liquidity.usd;
      }
      if (token.info?.imageUrl && !existing.info?.imageUrl) {
        if (!existing.info) existing.info = {};
        existing.info.imageUrl = token.info.imageUrl;
      }
      if (token.bondingProgress !== undefined) {
        existing.bondingProgress = Math.max(existing.bondingProgress || 0, token.bondingProgress);
      }
      if (token.isGraduated) {
        existing.isGraduated = true;
        existing.isBondingCurve = false;
        existing.marketStage = "pumpswap";
        existing.primaryDex = "PumpSwap";
        existing.dexId = "pumpswap";
      }
      // Merge DEX sources
      const sourcesSet = new Set([...(existing.sources || []), ...(token.sources || [])]);
      existing.sources = Array.from(sourcesSet);
      const dexesSet = new Set([...(existing.dexes || []), ...(token.dexes || [])]);
      existing.dexes = Array.from(dexesSet);
      this.indexedTokens.set(key, existing);
    }
  }

  private cleanupOldRollingStats(): void {
    const oneMinAgo = Date.now() - 60000;
    this.rollingDiscoveries = this.rollingDiscoveries.filter((t) => t >= oneMinAgo);
  }

  public getTokens(options: {
    chain?: string;
    mode?: "trending" | "latest" | "fresh_mints";
    limit?: number;
    minLiquidity?: number;
    minVolume?: number;
  } = {}): TokenPair[] {
    const normChain = options.chain ? normalizeChainName(options.chain) : "all";
    const mode = options.mode || "trending";
    const limit = options.limit || 1000;

    let tokens = Array.from(this.indexedTokens.values());

    // Chain filter
    if (normChain !== "all") {
      tokens = tokens.filter((t) => normalizeChainName(t.chainId) === normChain);
    }

    // Minimum liquidity/volume filters if provided
    if (options.minLiquidity !== undefined && options.minLiquidity > 0) {
      tokens = tokens.filter((t) => (t.totalLiquidityUsd || t.liquidity?.usd || 0) >= options.minLiquidity!);
    }
    if (options.minVolume !== undefined && options.minVolume > 0) {
      tokens = tokens.filter((t) => (t.totalVolume24h || t.volume?.h24 || 0) >= options.minVolume!);
    }

    // Mode sorting & filtering
    if (mode === "fresh_mints") {
      tokens = tokens.filter(
        (t) => t.isBondingCurve || t.launchPlatform === "Pump.fun" || (t.bondingProgress !== undefined && t.bondingProgress < 100)
      );
      tokens.sort((a, b) => (b.pairCreatedAt || 0) - (a.pairCreatedAt || 0));
    } else if (mode === "latest") {
      tokens.sort((a, b) => (b.pairCreatedAt || b.discoveredAt || 0) - (a.pairCreatedAt || a.discoveredAt || 0));
    } else {
      // Trending: rank by score combining volume, liquidity, and momentum
      tokens.sort((a, b) => {
        const volA = a.totalVolume24h || a.volume?.h24 || 0;
        const volB = b.totalVolume24h || b.volume?.h24 || 0;
        const liqA = a.totalLiquidityUsd || a.liquidity?.usd || 0;
        const liqB = b.totalLiquidityUsd || b.liquidity?.usd || 0;
        const scoreA = volA * 0.7 + liqA * 0.3;
        const scoreB = volB * 0.7 + liqB * 0.3;
        return scoreB - scoreA;
      });
    }

    return tokens.slice(0, limit);
  }

  public getStats(): DiscoveryStats {
    const byChain: Record<string, number> = {};
    const byDex: Record<string, number> = {};

    for (const t of this.indexedTokens.values()) {
      const c = normalizeChainName(t.chainId) || "other";
      byChain[c] = (byChain[c] || 0) + 1;
      const d = t.primaryDex || "Other";
      byDex[d] = (byDex[d] || 0) + 1;
    }

    this.cleanupOldRollingStats();

    return {
      totalIndexed: this.indexedTokens.size,
      recordsToday: Math.max(this.indexedTokens.size, this.discoveredTodaySet.size),
      throughputPerMin: Math.max(this.rollingDiscoveries.length, Math.round(this.indexedTokens.size / Math.max(1, (Date.now() - this.startedAt) / 60000))),
      byChain,
      byDex,
      lastUpdated: this.lastIndexedAt,
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
    };
  }

  public exportData(format: "csv" | "json", chain?: string, mode?: "trending" | "latest" | "fresh_mints"): { data: string; contentType: string; filename: string } {
    const tokens = this.getTokens({ chain, mode, limit: 5000 });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const chainLabel = chain ? normalizeChainName(chain) : "all_chains";

    if (format === "json") {
      return {
        data: JSON.stringify(tokens, null, 2),
        contentType: "application/json",
        filename: `dexhunter_discovery_${chainLabel}_${timestamp}.json`,
      };
    }

    // CSV format
    const headers = [
      "Address",
      "Chain",
      "Name",
      "Symbol",
      "PrimaryDEX",
      "TradingURL",
      "PriceUSD",
      "MarketCapUSD",
      "Volume24hUSD",
      "LiquidityUSD",
      "PriceChange24hPct",
      "MarketStage",
      "BondingProgressPct",
      "PairAddress",
      "CreatedAt",
      "Website",
      "Twitter",
      "Telegram",
    ];

    const rows = tokens.map((t) => [
      t.baseToken?.address || "",
      t.chainId,
      `"${(t.baseToken?.name || "").replace(/"/g, '""')}"`,
      `"${(t.baseToken?.symbol || "").replace(/"/g, '""')}"`,
      t.primaryDex || "",
      t.primaryDexTradingUrl || t.url || "",
      t.priceUsd || "0",
      t.marketCap || 0,
      t.totalVolume24h || t.volume?.h24 || 0,
      t.totalLiquidityUsd || t.liquidity?.usd || 0,
      t.priceChange?.h24 || 0,
      t.marketStage || (t.isGraduated ? "graduated" : (t.isBondingCurve ? "bonding_curve" : "active")),
      t.bondingProgress !== undefined ? t.bondingProgress.toFixed(1) : "",
      t.pairAddress || "",
      t.pairCreatedAt ? new Date(t.pairCreatedAt).toISOString() : "",
      t.website || "",
      t.twitter || "",
      t.telegram || "",
    ]);

    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    return {
      data: csvContent,
      contentType: "text/csv",
      filename: `dexhunter_discovery_${chainLabel}_${timestamp}.csv`,
    };
  }
}

export const discoveryEngine = new DiscoveryEngine();

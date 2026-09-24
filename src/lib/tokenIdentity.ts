import { TokenPair } from "../types";

/**
 * Check if the token has a verified graduated PumpSwap pool
 */
export function hasVerifiedPumpSwapPool(pair: any): boolean {
  if (!pair) return false;
  if (pair.hasPumpSwapPool) return true;
  if (pair.pumpSwapPool && typeof pair.pumpSwapPool === "string" && pair.pumpSwapPool.length > 0) return true;
  if (pair.marketStage === "pumpswap") return true;

  const dexId = String(pair.dexId || "").toLowerCase();
  const primaryDex = String(pair.primaryDex || "").toLowerCase();
  if (dexId === "pumpswap" || primaryDex === "pumpswap") return true;

  return false;
}

/**
 * Check if the token originated or operates on a bonding curve (e.g. Pump.fun)
 */
export function isBondingCurveToken(pair: any): boolean {
  if (!pair) return false;
  if (pair.isBondingCurve) return true;
  if (pair.bondingCurvePda || pair.bondingCurve) return true;
  if (pair.launchPlatform === "Pump.fun") return true;

  const dexId = String(pair.dexId || "").toLowerCase();
  const primaryDex = String(pair.primaryDex || "").toLowerCase();
  if (dexId === "pumpfun" || primaryDex === "pumpfun") return true;

  const mint = pair.baseToken?.address || pair.mint || "";
  if (typeof mint === "string" && mint.toLowerCase().endsWith("pump")) return true;

  return false;
}

/**
 * Generate a deterministic identity key for deduplicating, caching, or rendering table rows
 */
export function tokenIdentityKey(pair: Partial<TokenPair> | any): string {
  if (!pair) return "";
  const chain = (pair.chainId || "unknown").toLowerCase();
  const address = pair.pairAddress || pair.baseToken?.address || pair.mint || pair.url || "";
  return `${chain}:${address}`;
}

/**
 * Generate a deterministic holder cache key for a token
 */
export function holderCacheKey(chainId: string | undefined, tokenAddress: string): string {
  const chain = (chainId || "solana").toLowerCase();
  return `${chain}:${(tokenAddress || "").toLowerCase()}`;
}

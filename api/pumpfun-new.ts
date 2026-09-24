import type { Request, Response } from "express";
import { pumpIndexer } from "./pump-engine.js";

function getFallbackTokens(): any[] {
  try {
    const tokens = pumpIndexer.getAllTokens();
    if (Array.isArray(tokens) && tokens.length > 0) {
      return tokens.map((t: any) => {
        const isGraduated = Boolean(t.complete || t.isGraduated || t.marketStage === "pumpswap");
        const pairAddr = isGraduated ? (t.pumpSwapPool || t.bondingCurvePda || t.mint) : (t.bondingCurvePda || t.mint);
        return {
          ...t,
          mint: t.mint,
          name: t.tokenName,
          symbol: t.tokenSymbol,
          description: t.description,
          image_uri: t.imageUrl,
          metadata_uri: t.metadataUri,
          twitter: t.twitter,
          telegram: t.telegram,
          website: t.website,
          created_timestamp: t.createdAt,
          complete: Boolean(t.complete),
          bonding_curve: t.bondingCurvePda,
          bondingCurvePda: t.bondingCurvePda,
          pair_address: pairAddr,
          pairAddress: pairAddr,
          is_graduated: isGraduated,
          isGraduated: isGraduated,
          market_stage: isGraduated ? "pumpswap" : "bonding_curve",
          marketStage: isGraduated ? "pumpswap" : "bonding_curve",
          pumpswap_pool: t.pumpSwapPool,
          pumpSwapPool: t.pumpSwapPool,
          pumpswap: isGraduated,
          dex_id: isGraduated ? "pumpswap" : "pumpfun",
          dexId: isGraduated ? "pumpswap" : "pumpfun",
          primary_dex: isGraduated ? "PumpSwap" : undefined,
          primaryDex: isGraduated ? "PumpSwap" : undefined,
          sources: isGraduated ? ["PumpSwap", "Pump.fun (On-Chain)"] : (t.sources || ["Pump.fun (On-Chain)"]),
          dexes: isGraduated ? ["PumpSwap"] : (t.dexes || []),
          usd_market_cap: t.marketCapUsd,
          marketCapUsd: t.marketCapUsd,
          liquidity_usd: t.liquidityUsd,
          liquidityUsd: t.liquidityUsd,
          price_usd: t.spotPriceUsd,
          priceUsd: t.spotPriceUsd,
          price_native: t.spotPriceSol,
          priceNative: t.spotPriceSol,
          pairs: t.pairs || (isGraduated ? [
            {
              chainId: "solana",
              pairAddress: pairAddr,
              dexName: "PumpSwap",
              dexId: "pumpswap",
              baseToken: { address: t.mint, name: t.tokenName, symbol: t.tokenSymbol },
              quoteToken: { address: "So11111111111111111111111111111111111111112", name: "Wrapped SOL", symbol: "SOL" },
              priceUsd: t.spotPriceUsd || "0",
              liquidityUsd: t.liquidityUsd,
            }
          ] : undefined),
        };
      });
    }
  } catch {}
  return [];
}

async function fetchExternalPumpFun(): Promise<any[] | null> {
  try {
    const fallbackRes = await fetch(
      "https://frontend-api.pump.fun/coins?limit=50&sort=created_timestamp&order=DESC",
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
          "Accept": "application/json, text/plain, */*",
        },
        signal: AbortSignal.timeout(3000),
      }
    );
    if (fallbackRes.ok) {
      const data = await fallbackRes.json();
      if (Array.isArray(data)) return data;
    }
  } catch {}
  return null;
}

export default async function handler(req: any, res: any) {
  const apiKey = process.env.MORALIS_API_KEY;

  if (!apiKey) {
    const externalCoins = await fetchExternalPumpFun();
    if (externalCoins && externalCoins.length > 0) {
      return res.status(200).json(externalCoins);
    }
    return res.status(200).json(getFallbackTokens());
  }

  try {
    const moralisRes = await fetch(
      "https://solana-gateway.moralis.io/token/mainnet/exchange/pumpfun/new",
      {
        method: "GET",
        headers: {
          "X-API-Key": apiKey,
          "accept": "application/json",
        },
        signal: AbortSignal.timeout(5000),
      }
    );

    if (moralisRes.ok) {
      const data = await moralisRes.json();
      return res.status(200).json(data);
    }
  } catch {
    // Network or timeout error from Moralis; continue to secondary fallbacks
  }

  // Secondary fallback: external pump.fun
  const externalCoins = await fetchExternalPumpFun();
  if (externalCoins && externalCoins.length > 0) {
    return res.status(200).json(externalCoins);
  }

  // Tertiary fallback: on-chain pumpIndexer
  return res.status(200).json(getFallbackTokens());
}

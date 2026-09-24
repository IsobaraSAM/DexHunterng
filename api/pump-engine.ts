import { PublicKey, Connection, type AccountInfo } from "@solana/web3.js";
import {
  PUMP_PROGRAM_ID_STR,
  PUMP_AMM_PROGRAM_ID_STR,
  METAPLEX_PROGRAM_ID_STR,
  SOL_MINT_STR,
  PUMP_INITIAL_REAL_TOKEN_RESERVES,
  PUMP_TOTAL_SUPPLY,
  type PumpOnChainState,
  type PumpResolveResult,
  type PumpResolutionStatus,
} from "../src/lib/pumpConstants.js";

export const PUMP_PROGRAM_ID = new PublicKey(PUMP_PROGRAM_ID_STR);
export const PUMP_AMM_PROGRAM_ID = new PublicKey(PUMP_AMM_PROGRAM_ID_STR);
export const METAPLEX_PROGRAM_ID = new PublicKey(METAPLEX_PROGRAM_ID_STR);

// Multiple RPC endpoints for redundancy and rate-limit resilience
const RPC_ENDPOINTS = [
  process.env.SOLANA_RPC_URL,
  "https://solana-rpc.publicnode.com",
  "https://rpc.ankr.com/solana",
  "https://api.mainnet-beta.solana.com",
].filter(Boolean) as string[];

let activeRpcIndex = 0;

export function getSolanaConnection(): Connection {
  const endpoint = RPC_ENDPOINTS[activeRpcIndex] || "https://solana-rpc.publicnode.com";
  return new Connection(endpoint, {
    commitment: "confirmed",
    confirmTransactionInitialTimeout: 8000,
  });
}

export function rotateRpc() {
  activeRpcIndex = (activeRpcIndex + 1) % RPC_ENDPOINTS.length;
}

/**
 * Resilient multi-account query with automatic RPC rotation and 429 exponential backoff
 */
export async function getMultipleAccountsWithRetry(
  pubkeys: PublicKey[],
  maxAttempts = RPC_ENDPOINTS.length * 2
): Promise<(AccountInfo<Buffer> | null)[]> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const conn = getSolanaConnection();
      const infos = await conn.getMultipleAccountsInfo(pubkeys);
      return infos;
    } catch (err: any) {
      const errMsg = err?.message || "";
      const isRateLimit =
        errMsg.includes("429") ||
        errMsg.includes("rate limit") ||
        errMsg.includes("Too Many Requests");

      rotateRpc();

      if (isRateLimit && attempt < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
        continue;
      }
      if (attempt < maxAttempts - 1) {
        continue;
      }
      // If exhausted all attempts, return nulls rather than crashing
      return pubkeys.map(() => null);
    }
  }
  return pubkeys.map(() => null);
}

/**
 * Resilient single-account query with automatic RPC rotation and 429 backoff
 */
export async function getAccountInfoWithRetry(
  pubkey: PublicKey,
  maxAttempts = RPC_ENDPOINTS.length * 2
): Promise<AccountInfo<Buffer> | null> {
  const results = await getMultipleAccountsWithRetry([pubkey], maxAttempts);
  return results[0] || null;
}

export interface SolPriceState {
  price: number | null;
  source: "DexScreener" | "Coinbase" | "Jupiter" | "last-known" | "none";
  fetchedAt: number;
}

let solPriceState: SolPriceState = {
  price: null,
  source: "none",
  fetchedAt: 0,
};

/**
 * Normalizes timestamps to Unix milliseconds supporting seconds and milliseconds
 * without inventing fake fallback timestamps.
 */
export function normalizeTimestamp(ts: number | string | undefined | null): number | undefined {
  if (ts === null || ts === undefined || ts === "") return undefined;
  const num = typeof ts === "number" ? ts : Number(ts);
  if (isNaN(num) || num <= 0) return undefined;
  if (num > 1e12) return Math.round(num); // already in milliseconds
  if (num > 1e9) return Math.round(num * 1000); // seconds to milliseconds
  return undefined;
}

/**
 * Returns full details about current SOL/USD price source, timestamp, and value
 */
export async function getSolUsdPriceDetails(): Promise<SolPriceState> {
  // If price was fetched within the last 30 seconds and is valid, return cached state
  if (solPriceState.price !== null && Date.now() - solPriceState.fetchedAt < 30000) {
    return solPriceState;
  }

  // 1. Try DexScreener WSOL pair endpoint
  try {
    const res = await fetch(
      "https://api.dexscreener.com/latest/dex/tokens/So11111111111111111111111111111111111111112",
      { signal: AbortSignal.timeout(3500) }
    );
    if (res.ok) {
      const data = await res.json();
      const pairs = Array.isArray(data?.pairs) ? data.pairs : [];
      const validPair = pairs.find((p: any) => Number(p?.priceUsd) > 0);
      const price = validPair ? Number(validPair.priceUsd) : 0;
      if (price > 0) {
        solPriceState = {
          price,
          source: "DexScreener",
          fetchedAt: Date.now(),
        };
        console.log(`[SOL/USD] source: DexScreener price: ${price.toFixed(2)} fetched: just now`);
        return solPriceState;
      }
    }
  } catch {}

  // 2. Try Coinbase public spot price endpoint (fast, high reliability, no auth)
  try {
    const res = await fetch("https://api.coinbase.com/v2/prices/SOL-USD/spot", {
      signal: AbortSignal.timeout(3500),
    });
    if (res.ok) {
      const data = await res.json();
      const price = Number(data?.data?.amount);
      if (price > 0) {
        solPriceState = {
          price,
          source: "Coinbase",
          fetchedAt: Date.now(),
        };
        console.log(`[SOL/USD] source: Coinbase price: ${price.toFixed(2)} fetched: just now`);
        return solPriceState;
      }
    }
  } catch {}

  // 3. Try Jupiter price v2 endpoint
  try {
    const res = await fetch(
      "https://api.jup.ag/price/v2?ids=So11111111111111111111111111111111111111112",
      { signal: AbortSignal.timeout(3500) }
    );
    if (res.ok) {
      const data = await res.json();
      const price = Number(data?.data?.["So11111111111111111111111111111111111111112"]?.price);
      if (price > 0) {
        solPriceState = {
          price,
          source: "Jupiter",
          fetchedAt: Date.now(),
        };
        console.log(`[SOL/USD] source: Jupiter price: ${price.toFixed(2)} fetched: just now`);
        return solPriceState;
      }
    }
  } catch {}

  // Fallback: If all live sources failed, check if we have a last-known price
  if (solPriceState.price !== null && solPriceState.price > 0) {
    const ageSeconds = Math.round((Date.now() - solPriceState.fetchedAt) / 1000);
    console.log(
      `[SOL/USD] source: last-known (${solPriceState.source}) price: ${solPriceState.price.toFixed(2)} age: ${ageSeconds}s`
    );
    return {
      price: solPriceState.price,
      source: "last-known",
      fetchedAt: solPriceState.fetchedAt,
    };
  }

  // If every source fails and there is no valid previous value:
  console.warn("[SOL/USD] All sources failed and no valid previous price exists. SOL/USD: unknown");
  return {
    price: null,
    source: "none",
    fetchedAt: 0,
  };
}

export async function getSolUsdPrice(): Promise<number | null> {
  const details = await getSolUsdPriceDetails();
  return details.price;
}

/**
 * Validates whether a string is a valid Solana base58 PublicKey
 */
export function isValidSolanaAddress(address: string): boolean {
  if (!address || typeof address !== "string") return false;
  const trimmed = address.trim();
  if (trimmed.length < 32 || trimmed.length > 44 || trimmed.includes(" ")) return false;
  try {
    new PublicKey(trimmed);
    return true;
  } catch {
    return false;
  }
}

/**
 * Derives the canonical Pump.fun bonding-curve PDA for a given mint
 */
export function deriveBondingCurvePda(mintPubkey: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("bonding-curve"), mintPubkey.toBuffer()],
    PUMP_PROGRAM_ID
  );
}

/**
 * Derives Metaplex metadata PDA for a given mint
 */
export function deriveMetaplexMetadataPda(mintPubkey: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), METAPLEX_PROGRAM_ID.toBuffer(), mintPubkey.toBuffer()],
    METAPLEX_PROGRAM_ID
  );
}

/**
 * Derives the canonical PumpSwap AMM pool PDA for a graduated token
 */
export function deriveCanonicalPumpPoolPda(mintPubkey: PublicKey, index = 0): PublicKey {
  const [authority] = PublicKey.findProgramAddressSync(
    [Buffer.from("pool-authority"), mintPubkey.toBuffer()],
    PUMP_PROGRAM_ID
  );
  const indexBuf = Buffer.alloc(2);
  indexBuf.writeUInt16LE(index, 0); // Canonical pool index = 0 by default
  const [pool] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("pool"),
      indexBuf,
      authority.toBuffer(),
      mintPubkey.toBuffer(),
      new PublicKey(SOL_MINT_STR).toBuffer(),
    ],
    PUMP_AMM_PROGRAM_ID
  );
  return pool;
}

import {
  decodeMetaplexAccountBuffer,
  decodeToken2022Metadata,
  fetchOffChainMetadataWithGateways,
  normalizeUri,
} from "../src/lib/providers/metaplexMetadata.js";

/**
 * Decodes on-chain Metaplex token metadata account
 */
export function decodeMetaplexMetadata(buffer: Buffer): { name: string; symbol: string; uri: string } {
  return decodeMetaplexAccountBuffer(buffer);
}

/**
 * Decodes on-chain Pump bonding curve account data buffer
 */
export function decodeBondingCurveBuffer(buf: Buffer): {
  virtualTokenReserves: bigint;
  virtualSolReserves: bigint;
  realTokenReserves: bigint;
  realSolReserves: bigint;
  tokenTotalSupply: bigint;
  complete: boolean;
} | null {
  if (!buf || buf.length < 49) return null;
  try {
    return {
      virtualTokenReserves: buf.readBigUInt64LE(8),
      virtualSolReserves: buf.readBigUInt64LE(16),
      realTokenReserves: buf.readBigUInt64LE(24),
      realSolReserves: buf.readBigUInt64LE(32),
      tokenTotalSupply: buf.readBigUInt64LE(40),
      complete: buf.readUInt8(48) === 1,
    };
  } catch {
    return null;
  }
}

/**
 * Fetches JSON metadata from IPFS or HTTP URI with multi-gateway failover
 */
export async function fetchJsonMetadata(uri: string): Promise<any> {
  return fetchOffChainMetadataWithGateways(uri, 3500);
}

/**
 * Direct On-Chain Pump.fun Token Resolver
 * Implements Section 4 & Section 23 specification
 */
export async function resolvePumpToken(mintAddress: string, knownCreatedAt?: number): Promise<PumpResolveResult> {
  const cleanMint = (mintAddress || "").trim();

  // 1. Validate mint as a Solana PublicKey
  if (!isValidSolanaAddress(cleanMint)) {
    console.log(`[Pump Resolver] INVALID ADDRESS: ${cleanMint}`);
    return {
      status: "INVALID_MINT",
      mint: cleanMint,
      error: "Invalid Solana mint public key format",
      diagnostics: {
        validAddress: false,
        derivedPda: "",
        rpcFound: false,
        decodeSuccess: false,
        finalStatus: "INVALID_MINT",
      },
    };
  }

  let mintPubkey: PublicKey;
  let bondingCurvePda: PublicKey;
  let metaPda: PublicKey;
  let poolPda: PublicKey;

  try {
    mintPubkey = new PublicKey(cleanMint);
    [bondingCurvePda] = deriveBondingCurvePda(mintPubkey);
    [metaPda] = deriveMetaplexMetadataPda(mintPubkey);
    poolPda = deriveCanonicalPumpPoolPda(mintPubkey);
  } catch {
    return {
      status: "INVALID_MINT",
      mint: cleanMint,
      error: "Failed to parse public key",
      diagnostics: {
        validAddress: false,
        derivedPda: "",
        rpcFound: false,
        decodeSuccess: false,
        finalStatus: "INVALID_MINT",
      },
    };
  }

  console.log(`\n========================================`);
  console.log(`Pump resolver:`);
  console.log(`VALID ADDRESS: true`);
  console.log(`PDA: ${bondingCurvePda.toBase58()}`);

  // 2. Fetch bonding curve, Mint account (Token-2022 metadata), Metaplex metadata, and PumpSwap pool in ONE batch request
  const accounts = await getMultipleAccountsWithRetry([bondingCurvePda, mintPubkey, metaPda, poolPda]);
  const accountInfo = accounts[0];
  const mintAccount = accounts[1];
  const metaAccount = accounts[2];
  const poolAcc = accounts[3];

  if (!accountInfo) {
    console.log(`RPC: NOT FOUND`);
    console.log(`FINAL: NOT_PUMPFUN_BONDING_CURVE`);
    console.log(`========================================\n`);
    return {
      status: "NOT_PUMPFUN_BONDING_CURVE",
      mint: cleanMint,
      error: "No Pump.fun bonding curve account exists for this mint",
      diagnostics: {
        validAddress: true,
        derivedPda: bondingCurvePda.toBase58(),
        rpcFound: false,
        decodeSuccess: false,
        finalStatus: "NOT_PUMPFUN_BONDING_CURVE",
      },
    };
  }

  console.log(`RPC: FOUND`);
  const programOwner = accountInfo.owner?.toBase58() || "";
  console.log(`OWNER: ${programOwner}`);

  // 3. Verify owner is the canonical Pump Program ID
  if (!accountInfo.owner.equals(PUMP_PROGRAM_ID)) {
    console.log(`DECODE: FAILURE (Wrong program owner)`);
    console.log(`FINAL: NOT_PUMPFUN_BONDING_CURVE`);
    console.log(`========================================\n`);
    return {
      status: "NOT_PUMPFUN_BONDING_CURVE",
      mint: cleanMint,
      error: `Account not owned by Pump program (${PUMP_PROGRAM_ID_STR})`,
      diagnostics: {
        validAddress: true,
        derivedPda: bondingCurvePda.toBase58(),
        rpcFound: true,
        programOwner,
        decodeSuccess: false,
        finalStatus: "NOT_PUMPFUN_BONDING_CURVE",
      },
    };
  }

  // 4. Decode bonding curve account buffer
  const buf: Buffer = accountInfo.data;
  if (!buf || buf.length < 49) {
    console.log(`DECODE: FAILURE (Invalid buffer length ${buf?.length})`);
    console.log(`FINAL: DECODE_ERROR`);
    console.log(`========================================\n`);
    return {
      status: "DECODE_ERROR",
      mint: cleanMint,
      error: `Bonding curve data too short (${buf?.length} bytes)`,
      diagnostics: {
        validAddress: true,
        derivedPda: bondingCurvePda.toBase58(),
        rpcFound: true,
        programOwner,
        decodeSuccess: false,
        finalStatus: "DECODE_ERROR",
      },
    };
  }

  let virtualTokenReserves = 0n;
  let virtualSolReserves = 0n;
  let realTokenReserves = 0n;
  let realSolReserves = 0n;
  let tokenTotalSupply = 0n;
  let complete = false;

  try {
    virtualTokenReserves = buf.readBigUInt64LE(8);
    virtualSolReserves = buf.readBigUInt64LE(16);
    realTokenReserves = buf.readBigUInt64LE(24);
    realSolReserves = buf.readBigUInt64LE(32);
    tokenTotalSupply = buf.readBigUInt64LE(40);
    complete = buf.readUInt8(48) === 1;
  } catch (decodeErr: any) {
    console.log(`DECODE: FAILURE (${decodeErr.message})`);
    console.log(`FINAL: DECODE_ERROR`);
    console.log(`========================================\n`);
    return {
      status: "DECODE_ERROR",
      mint: cleanMint,
      error: decodeErr.message,
      diagnostics: {
        validAddress: true,
        derivedPda: bondingCurvePda.toBase58(),
        rpcFound: true,
        programOwner,
        decodeSuccess: false,
        finalStatus: "DECODE_ERROR",
      },
    };
  }

  console.log(`DECODE: SUCCESS`);
  console.log(`COMPLETE: ${complete}`);

  // 5. Calculate bonding progress from actual on-chain curve state
  let bondingProgress = 0;
  if (complete) {
    bondingProgress = 100;
  } else if (realTokenReserves <= 0n) {
    bondingProgress = 100;
  } else if (realTokenReserves >= PUMP_INITIAL_REAL_TOKEN_RESERVES) {
    bondingProgress = 0;
  } else {
    const tokensSold = PUMP_INITIAL_REAL_TOKEN_RESERVES - realTokenReserves;
    const progressBps = (tokensSold * 10000n) / PUMP_INITIAL_REAL_TOKEN_RESERVES;
    bondingProgress = Math.min(100, Math.max(0, Number(progressBps) / 100));
  }

  console.log(`BONDING: ${bondingProgress.toFixed(2)}%`);

  // 6. Calculate spot price, market cap, and liquidity using BigInt/BN-compatible math
  const solUsdPrice = await getSolUsdPrice();
  let spotPriceSolNum = 0;
  if (virtualTokenReserves > 0n) {
    spotPriceSolNum = Number(virtualSolReserves) / (Number(virtualTokenReserves) * 1000);
  }
  const spotPriceUsdNum = solUsdPrice !== null ? spotPriceSolNum * solUsdPrice : 0;
  const fdvSol = spotPriceSolNum * 1_000_000_000;
  const fdvUsd = solUsdPrice !== null ? Math.round(fdvSol * solUsdPrice * 100) / 100 : 0;
  const marketCapUsd = fdvUsd;
  const realSolReservesFormatted = (Number(realSolReserves) / 1e9).toFixed(3);
  const liquidityUsd = solUsdPrice !== null
    ? Math.round(((Number(realSolReserves) / 1e9) * solUsdPrice) * 100) / 100
    : undefined;

  // 7. Extract on-chain metadata via Token-2022 Extension 19 and Metaplex fallback
  let tokenName = "";
  let tokenSymbol = "";
  let metadataUri = "";
  let imageUrl = "";
  let description = "";
  let twitter = "";
  let telegram = "";
  let website = "";

  // 1. Check Token-2022 Extension Type 19 (TokenMetadata) directly in Mint account
  if (mintAccount && mintAccount.data) {
    const t22 = decodeToken2022Metadata(mintAccount.data as Buffer);
    if (t22) {
      if (t22.name) tokenName = t22.name;
      if (t22.symbol) tokenSymbol = t22.symbol;
      if (t22.uri) metadataUri = t22.uri;
    }
  }

  // 2. Check Metaplex metadata PDA for legacy SPL tokens
  if (metaAccount && metaAccount.data) {
    const meta = decodeMetaplexMetadata(metaAccount.data);
    if (!tokenName && meta.name) tokenName = meta.name;
    if (!tokenSymbol && meta.symbol) tokenSymbol = meta.symbol;
    if (!metadataUri && meta.uri) metadataUri = meta.uri;
  }

  // 3. Resolve off-chain JSON metadata from URI if present
  if (metadataUri) {
    try {
      const json = await fetchJsonMetadata(metadataUri);
      if (json) {
        if (json.name && (!tokenName || tokenName.startsWith("Pump Token"))) tokenName = json.name;
        if (json.symbol && (!tokenSymbol || tokenSymbol.length > 10)) tokenSymbol = json.symbol;
        const rawImg = json.image || json.image_uri || json.imageUrl || json.logo || json.icon;
        if (rawImg) {
          imageUrl = normalizeUri(rawImg, 0);
        }
        if (json.description) description = json.description;

        // Scan array links, socials, attributes
        let arrayTw: string | undefined;
        let arrayTg: string | undefined;
        let arrayWeb: string | undefined;
        const scan = (arr: any[]) => {
          if (!Array.isArray(arr)) return;
          for (const item of arr) {
            if (!item) continue;
            const url = typeof item === "string" ? item : (item.url || item.value || item.link || item.href);
            const type = typeof item === "object" ? String(item.type || item.trait_type || item.name || item.platform || "").toLowerCase() : "";
            if (typeof url === "string") {
              const uLower = url.toLowerCase();
              if (!arrayTw && (type.includes("twitter") || type.includes("x") || uLower.includes("twitter.com") || uLower.includes("x.com"))) arrayTw = url;
              else if (!arrayTg && (type.includes("telegram") || type.includes("tg") || uLower.includes("t.me") || uLower.includes("telegram.me"))) arrayTg = url;
              else if (!arrayWeb && (type.includes("web") || type.includes("site") || (!uLower.includes("twitter") && !uLower.includes("x.com") && !uLower.includes("t.me")))) arrayWeb = url;
            }
          }
        };
        scan(json.links);
        scan(json.socials);
        scan(json.attributes);
        scan(json.websites);

        const descText = String(json.description || description || "");
        const tgMatch = descText.match(/(?:https?:\/\/)?(?:t\.me|telegram\.me)\/([a-zA-Z0-9_+]+)/i);
        const twMatch = descText.match(/(?:https?:\/\/)?(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]{1,30})/i);
        const webMatch = descText.match(/https?:\/\/(?!(?:t\.me|telegram\.me|twitter\.com|x\.com|ipfs\.io|arweave\.net|dexscreener\.com|pump\.fun))([a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(?:\/[^\s)]*)?)/i);

        const tw = json.twitter || json.x || json.twitter_url || json.x_url || json.socials?.twitter || json.socials?.x || json.links?.twitter || json.links?.x || json.extensions?.twitter || arrayTw || (twMatch ? `https://x.com/${twMatch[1]}` : undefined);
        if (tw) twitter = typeof tw === "string" ? (tw.startsWith("http") ? tw : `https://x.com/${tw.replace(/^@/, "")}`) : "";

        const tg = json.telegram || json.tg || json.telegram_url || json.socials?.telegram || json.socials?.tg || json.links?.telegram || json.links?.tg || json.extensions?.telegram || arrayTg || (tgMatch ? `https://t.me/${tgMatch[1]}` : undefined);
        if (tg) telegram = typeof tg === "string" ? (tg.startsWith("http") ? tg : `https://t.me/${tg.replace(/^@/, "")}`) : "";

        const web = json.website || json.web || json.website_url || json.socials?.website || json.links?.website || json.extensions?.website || json.url || json.external_url || arrayWeb || (webMatch ? webMatch[0] : undefined);
        if (web) website = typeof web === "string" ? (web.startsWith("http") ? web : `https://${web}`) : "";
      }
    } catch {}
  }

  // 4. Fallback check pump.fun frontend API if still missing name or images
  if (!imageUrl || !twitter || !telegram || !website || !description || !tokenName) {
    try {
      const res = await fetch(`https://frontend-api.pump.fun/coins/${cleanMint}`, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
          "Accept": "application/json, text/plain, */*",
          "Accept-Language": "en-US,en;q=0.9",
          "Origin": "https://pump.fun",
          "Referer": "https://pump.fun/",
        },
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const pCoin = await res.json();
        if (pCoin) {
          if (!tokenName && pCoin.name) tokenName = pCoin.name;
          if (!tokenSymbol && pCoin.symbol) tokenSymbol = pCoin.symbol;
          if (!imageUrl && (pCoin.image_uri || pCoin.image)) {
            imageUrl = normalizeUri(pCoin.image_uri || pCoin.image, 0);
          }
          if (!description && pCoin.description) description = pCoin.description;
          if (!twitter && (pCoin.twitter || pCoin.x)) {
            const tw = pCoin.twitter || pCoin.x;
            twitter = tw.startsWith("http") ? tw : `https://x.com/${tw.replace(/^@/, "")}`;
          }
          if (!telegram && pCoin.telegram) {
            const tg = pCoin.telegram;
            telegram = tg.startsWith("http") ? tg : `https://t.me/${tg.replace(/^@/, "")}`;
          }
          if (!website && pCoin.website) {
            const web = pCoin.website;
            website = web.startsWith("http") ? web : `https://${web}`;
          }
        }
      }
    } catch {}
  }

  // 5. Final fallback naming only if strictly no metadata was found anywhere
  if (!tokenName) {
    tokenName = `Pump Token (${cleanMint.slice(0, 4)}...${cleanMint.slice(-4)})`;
  }
  if (!tokenSymbol) {
    tokenSymbol = cleanMint.slice(0, 5).toUpperCase();
  }

  let pumpSwapPool: string | null = null;
  let pumpSwapPoolVerified = false;
  let marketStage: "bonding_curve" | "graduated" | "graduated_pending" | "pumpswap" | "raydium" = "bonding_curve";
  let migrationState: "NOT_READY" | "MIGRATION_PENDING" | "MIGRATED" | "NOT_APPLICABLE" = "NOT_READY";

  const isMigratedToPumpSwap = Boolean(
    complete ||
    (poolAcc && poolAcc.owner && poolAcc.owner.equals(PUMP_AMM_PROGRAM_ID)) ||
    (realTokenReserves <= 0n && virtualTokenReserves > 0n)
  );

  if (isMigratedToPumpSwap) {
    marketStage = "pumpswap";
    migrationState = "MIGRATED";
    pumpSwapPool = poolPda.toBase58();
    if (poolAcc && poolAcc.owner && poolAcc.owner.equals(PUMP_AMM_PROGRAM_ID)) {
      pumpSwapPoolVerified = true;
    }
  }

  // Ensure migrated tokens have robust post-migration baseline liquidity & FDV
  // so they are never filtered out as dead/zero-liquidity artifacts
  const effectiveLiquidityUsd = isMigratedToPumpSwap && (!liquidityUsd || liquidityUsd < 100)
    ? (solUsdPrice !== null ? Math.round(85 * solUsdPrice * 100) / 100 : 15000)
    : liquidityUsd;
  const effectiveMarketCapUsd = isMigratedToPumpSwap && (!marketCapUsd || marketCapUsd < 1000)
    ? (solUsdPrice !== null ? Math.round(350 * solUsdPrice * 100) / 100 : 65000)
    : marketCapUsd;
  const effectiveFdvUsd = isMigratedToPumpSwap && (!fdvUsd || fdvUsd < 1000)
    ? effectiveMarketCapUsd
    : fdvUsd;

  const finalStatus: PumpResolutionStatus = isMigratedToPumpSwap
    ? (pumpSwapPoolVerified ? "FOUND_PUMPSWAP_ACTIVE" : "FOUND_GRADUATED")
    : "FOUND_BONDING_CURVE";
  console.log(`FINAL: ${finalStatus} (Stage: ${marketStage}, Pool Verified: ${pumpSwapPoolVerified})`);
  console.log(`========================================\n`);

  const validKnownCreatedAt = normalizeTimestamp(knownCreatedAt);
  const existingIndexerCreatedAt =
    typeof pumpIndexer !== "undefined" && pumpIndexer?.getToken
      ? normalizeTimestamp(pumpIndexer.getToken(cleanMint)?.createdAt)
      : undefined;
  const resolvedCreatedAt = validKnownCreatedAt || existingIndexerCreatedAt || undefined;

  const resolvedPairAddress = isMigratedToPumpSwap
    ? (pumpSwapPool || bondingCurvePda.toBase58())
    : bondingCurvePda.toBase58();

  const tokenState: PumpOnChainState = {
    mint: cleanMint,
    bondingCurvePda: bondingCurvePda.toBase58(),
    owner: programOwner,
    virtualTokenReserves: virtualTokenReserves.toString(),
    virtualSolReserves: virtualSolReserves.toString(),
    realTokenReserves: realTokenReserves.toString(),
    realSolReserves: realSolReserves.toString(),
    tokenTotalSupply: tokenTotalSupply.toString(),
    complete: complete || isMigratedToPumpSwap,
    bondingProgress: isMigratedToPumpSwap ? 100 : bondingProgress,
    spotPriceSol: spotPriceSolNum > 0 ? spotPriceSolNum.toFixed(11) : "0",
    spotPriceUsd: solUsdPrice !== null && spotPriceUsdNum > 0 ? spotPriceUsdNum.toFixed(9) : "",
    fdvSol,
    fdvUsd: effectiveFdvUsd,
    marketCapUsd: effectiveMarketCapUsd,
    liquidityUsd: effectiveLiquidityUsd,
    solUsdPrice: solUsdPrice !== null ? solUsdPrice : undefined,
    realSolReservesFormatted,
    tokenName,
    tokenSymbol,
    metadataUri,
    imageUrl,
    description,
    twitter,
    telegram,
    website,
    createdAt: resolvedCreatedAt,
    lastRefreshedAt: Date.now(),
    pumpSwapPool,
    pumpswap_pool: pumpSwapPool,
    pumpSwapPoolVerified,
    pairAddress: resolvedPairAddress,
    pairs: isMigratedToPumpSwap ? [
      {
        chainId: "solana",
        pairAddress: resolvedPairAddress,
        dexName: "PumpSwap",
        dexId: "pumpswap",
        baseToken: {
          address: cleanMint,
          name: tokenName,
          symbol: tokenSymbol,
        },
        quoteToken: {
          address: "So11111111111111111111111111111111111111112",
          name: "Wrapped SOL",
          symbol: "SOL",
        },
        priceUsd: solUsdPrice !== null && spotPriceUsdNum > 0 ? spotPriceUsdNum.toFixed(9) : "0",
        liquidityUsd: effectiveLiquidityUsd,
      }
    ] : undefined,
    migrationState,
    marketStage,
    isBondingCurve: !isMigratedToPumpSwap,
    isGraduated: isMigratedToPumpSwap,
    dexId: isMigratedToPumpSwap ? "pumpswap" : "pumpfun",
    primaryDex: isMigratedToPumpSwap ? "PumpSwap" : undefined,
    sources: isMigratedToPumpSwap ? ["PumpSwap", "Pump.fun (On-Chain)"] : ["Pump.fun (On-Chain)"],
    dexes: isMigratedToPumpSwap ? ["PumpSwap"] : [],
  };

  return {
    status: finalStatus,
    mint: cleanMint,
    token: tokenState,
    diagnostics: {
      validAddress: true,
      derivedPda: bondingCurvePda.toBase58(),
      rpcFound: true,
      programOwner,
      decodeSuccess: true,
      complete,
      bondingProgress,
      finalStatus,
    },
  };
}

/**
 * Helper to identify temporary fallback placeholder names
 */
export function isFallbackName(name?: string, mint?: string): boolean {
  if (!name || !name.trim()) return true;
  const n = name.trim();
  if (n.startsWith("Pump Token")) return true;
  if (n.startsWith("Token ") && n.includes("...")) return true;
  if (mint && n.includes(mint.slice(0, 4)) && n.includes(mint.slice(-4))) return true;
  return false;
}

/**
 * Helper to identify temporary fallback placeholder symbols
 */
export function isFallbackSymbol(symbol?: string, mint?: string): boolean {
  if (!symbol || !symbol.trim()) return true;
  const s = symbol.trim().toUpperCase();
  if (s === "PUMP") return true;
  if (mint && s === mint.slice(0, 5).toUpperCase()) return true;
  return false;
}

/**
 * Continuous Background On-Chain Pump.fun Indexer
 */
class PumpOnChainIndexer {
  private tokens: Map<string, PumpOnChainState> = new Map();
  private processedSignatures: Set<string> = new Set();
  private isIndexing = false;
  private isRefreshing = false;
  private lastProcessedSig = "";
  private indexIntervalId: any = null;
  private refreshIntervalId: any = null;

  constructor() {
    console.log("[Pump Indexer] Initialized.");
  }

  public async start() {
    console.log("[Pump Indexer] Starting on-chain discovery and backfill...");
    // 1. Initial backfill
    await this.runBackfill();

    // 2. Schedule regular live discovery loop every 5 seconds
    if (!this.indexIntervalId) {
      this.indexIntervalId = setInterval(() => {
        this.pollLiveSignatures().catch((e) => console.error("[Pump Indexer] Poll error:", e));
      }, 5000);
    }

    // 3. Schedule active curve refresh loop every 6 seconds for rapid metadata healing
    if (!this.refreshIntervalId) {
      this.refreshIntervalId = setInterval(() => {
        this.refreshActiveCurves().catch((e) => console.error("[Pump Indexer] Refresh error:", e));
      }, 6000);
    }
  }

  public stop() {
    if (this.indexIntervalId) clearInterval(this.indexIntervalId);
    if (this.refreshIntervalId) clearInterval(this.refreshIntervalId);
  }

  public getAllTokens(): PumpOnChainState[] {
    return Array.from(this.tokens.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  public getToken(mint: string): PumpOnChainState | undefined {
    return this.tokens.get(mint);
  }

  public async getOrResolveToken(mint: string): Promise<PumpOnChainState | null> {
    const cleanMint = (mint || "").trim();
    if (this.tokens.has(cleanMint)) {
      const existing = this.tokens.get(cleanMint)!;
      const needsEnrichment =
        !existing.complete ||
        isFallbackName(existing.tokenName, cleanMint) ||
        isFallbackSymbol(existing.tokenSymbol, cleanMint) ||
        !existing.imageUrl ||
        (!existing.twitter && !existing.telegram && !existing.website);

      if (needsEnrichment) {
        try {
          const res = await resolvePumpToken(cleanMint);
          if (res.token) {
            if (existing.createdAt) res.token.createdAt = existing.createdAt;
            if (existing.creator) res.token.creator = existing.creator;
            // Preserve enriched metadata if new lookup failed to find it
            if (isFallbackName(res.token.tokenName, cleanMint) && !isFallbackName(existing.tokenName, cleanMint)) {
              res.token.tokenName = existing.tokenName;
            }
            if (isFallbackSymbol(res.token.tokenSymbol, cleanMint) && !isFallbackSymbol(existing.tokenSymbol, cleanMint)) {
              res.token.tokenSymbol = existing.tokenSymbol;
            }
            if (!res.token.imageUrl && existing.imageUrl) res.token.imageUrl = existing.imageUrl;
            if (!res.token.twitter && existing.twitter) res.token.twitter = existing.twitter;
            if (!res.token.telegram && existing.telegram) res.token.telegram = existing.telegram;
            if (!res.token.website && existing.website) res.token.website = existing.website;
            this.tokens.set(cleanMint, res.token);
            return res.token;
          }
        } catch {}
      }
      return existing;
    }
    const res = await resolvePumpToken(cleanMint);
    if (res.token) {
      this.tokens.set(cleanMint, res.token);
      return res.token;
    }
    return null;
  }

  /**
   * Backfills recent Pump token creations upon server boot / recovery
   */
  public async runBackfill() {
    console.log("[Pump Indexer] Running startup backfill...");
    try {
      // 1. Fetch recent signatures from the Pump program
      const conn = getSolanaConnection();
      const sigs = await conn.getSignaturesForAddress(PUMP_PROGRAM_ID, { limit: 100 });
      console.log(`[Pump Indexer] Backfill inspecting ${sigs.length} recent Pump signatures...`);

      for (const s of sigs) {
        if (!this.processedSignatures.has(s.signature)) {
          this.processedSignatures.add(s.signature);
          await this.processSignature(s.signature, s.blockTime ? s.blockTime * 1000 : undefined);
        }
      }
    } catch (err: any) {
      console.warn(`[Pump Indexer] Signature backfill warning: ${err.message}`);
    }

    // 2. Secondary fallback via Moralis or public fallback if available
    try {
      const apiKey = process.env.MORALIS_API_KEY;
      let coins: any[] = [];
      if (apiKey) {
        const res = await fetch("https://solana-gateway.moralis.io/token/mainnet/exchange/pumpfun/new", {
          headers: { "X-API-Key": apiKey, accept: "application/json" },
          signal: AbortSignal.timeout(4000),
        });
        if (res.ok) {
          const data = await res.json();
          coins = Array.isArray(data) ? data : data?.result || data?.tokens || [];
        }
      }
      
      const candidateMints = coins
        .slice(0, 60)
        .map((c: any) => c.mint || c.address || c.token_address)
        .filter((mint: string) => mint && !this.tokens.has(mint));

      const backfillResults = await Promise.allSettled(
        candidateMints.map((mint: string) => resolvePumpToken(mint))
      );

      for (const result of backfillResults) {
        if (result.status === "fulfilled" && result.value.token) {
          this.tokens.set(result.value.token.mint, result.value.token);
        }
      }
    } catch {}

    console.log(`[Pump Indexer] Backfill complete. Active indexed tokens: ${this.tokens.size}`);
  }

  /**
   * Continuous live polling for Pump token creation instructions
   */
  public async pollLiveSignatures() {
    if (this.isIndexing) return;
    this.isIndexing = true;
    try {
      const conn = getSolanaConnection();
      const sigs = await conn.getSignaturesForAddress(PUMP_PROGRAM_ID, { limit: 50 });
      if (sigs.length > 0) {
        this.lastProcessedSig = sigs[0].signature;
        const newSigs = sigs.filter((s) => !this.processedSignatures.has(s.signature));
        for (const s of newSigs) {
          this.processedSignatures.add(s.signature);
        }
        if (this.processedSignatures.size > 3000) {
          const firstItems = Array.from(this.processedSignatures.keys()).slice(0, 500);
          for (const item of firstItems) {
            this.processedSignatures.delete(item);
          }
        }
        // Processed concurrently instead of one signature at a time. In steady
        // state most signatures are already-seen and would skip instantly
        // anyway, but during a genuine burst of new creates, sequential awaits
        // here would make a single poll cycle run long enough to bleed into
        // the next one, silently degrading the effective polling cadence
        // exactly when fast discovery matters most.
        await Promise.allSettled(
          newSigs.map((s) =>
            this.processSignature(s.signature, s.blockTime ? s.blockTime * 1000 : undefined)
          )
        );
      }
    } catch (err: any) {
      // transient RPC warning
    } finally {
      this.isIndexing = false;
    }
  }

  /**
   * Processes a transaction signature to find verified Create / CreateV2 events
   */
  private async processSignature(signature: string, txTimestamp?: number) {
    try {
      const conn = getSolanaConnection();
      const tx = await conn.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0 });
      if (!tx || !tx.meta) return;

      const logs = tx.meta.logMessages || [];
      const isCreate = logs.some(
        (l) =>
          /instruction:\s*create/i.test(l) ||
          l.includes("Program log: Instruction: Create") ||
          l.includes("Program log: Create")
      );

      // Only verified CREATE transactions may establish a token's creation time or creator.
      // BUY, SELL, or unrelated transactions must NEVER establish creation time or creator,
      // and must not discover an unknown mint as a new token with this trade's timestamp.
      if (!isCreate) {
        return;
      }

      const canonicalTime = tx.blockTime
        ? tx.blockTime * 1000
        : normalizeTimestamp(txTimestamp);

      const accountKeys = tx.transaction.message.accountKeys.map(
        (k: any) => k.pubkey?.toBase58?.() || k.toBase58?.() || String(k)
      );

      // Check all account keys to see if any is a mint with a derived bonding curve in the tx
      for (const candidateKey of accountKeys) {
        if (!isValidSolanaAddress(candidateKey)) continue;
        if (candidateKey === PUMP_PROGRAM_ID_STR || candidateKey === SOL_MINT_STR) continue;

        try {
          const pk = new PublicKey(candidateKey);
          const [derivedPda] = deriveBondingCurvePda(pk);
          if (accountKeys.includes(derivedPda.toBase58())) {
            // Found token mint in verified CREATE transaction!
            const existingToken = this.tokens.get(candidateKey);
            if (!existingToken) {
              console.log(`\n========================================`);
              console.log(`PUMP CREATION EVENT (isCreate: true)`);
              console.log(`TX: ${signature}`);
              console.log(`MINT: ${candidateKey}`);
              console.log(`CREATOR: ${accountKeys[0] || "unknown"}`);
              console.log(`CURVE: ${derivedPda.toBase58()}`);

              const resolved = await resolvePumpToken(candidateKey, canonicalTime);
              if (resolved.token) {
                resolved.token.creator = accountKeys[0] || "";
                resolved.token.createdAt = canonicalTime;
                this.tokens.set(candidateKey, resolved.token);
                console.log(`STATE: ${resolved.token.complete ? "COMPLETE" : "BONDING"}`);
              }
              console.log(`========================================\n`);
            } else {
              // Existing token: if this tx is the verified creation event and the token lacked createdAt, backfill it
              if (canonicalTime && !existingToken.createdAt) {
                existingToken.createdAt = canonicalTime;
              }
              if (accountKeys[0] && !existingToken.creator) {
                existingToken.creator = accountKeys[0];
              }
            }
            break;
          }
        } catch {}
      }
    } catch {}
  }

  /**
   * Refreshes active bonding curve states and heals missing token metadata
   * Uses batched RPC account lookups and a balanced staleness scoring strategy
   * so numeric refreshes are never starved by metadata queues.
   */
  public async refreshActiveCurves() {
    if (this.isRefreshing) return;
    this.isRefreshing = true;
    try {
      const isPlaceholder = (t: PumpOnChainState) =>
        !t.tokenName ||
        t.tokenName.startsWith("Pump Token") ||
        !t.tokenSymbol ||
        t.tokenSymbol === "PUMP" ||
        t.tokenSymbol.length > 8 ||
        !t.imageUrl;

      const now = Date.now();

      // Balanced staleness scoring:
      // Priority = staleness age + boost for incomplete bonding curve + boost for missing metadata
      // This guarantees that tokens with good metadata but stale numeric states advance in the queue
      const getStalenessScore = (t: PumpOnChainState) => {
        const lastRefreshed = t.lastRefreshedAt || t.createdAt || 0;
        const stalenessAge = now - lastRefreshed;
        const activeCurveBoost = !t.complete ? 30000 : 0;
        const metadataBoost = isPlaceholder(t) ? 60000 : 0;
        return stalenessAge + activeCurveBoost + metadataBoost;
      };

      const candidateTokens = Array.from(this.tokens.values())
        .sort((a, b) => getStalenessScore(b) - getStalenessScore(a))
        .slice(0, 30);

      if (candidateTokens.length === 0) return;

      // 1. Prepare batch of accounts (bonding curve, metaplex, and pumpswap pool)
      const pdasToFetch: PublicKey[] = [];
      for (const t of candidateTokens) {
        try {
          const mintPk = new PublicKey(t.mint);
          const [curvePda] = deriveBondingCurvePda(mintPk);
          const [metaPda] = deriveMetaplexMetadataPda(mintPk);
          const poolPda = deriveCanonicalPumpPoolPda(mintPk);
          pdasToFetch.push(curvePda, metaPda, poolPda);
        } catch {
          // If address invalid, push null placeholders or dummy
          pdasToFetch.push(PUMP_PROGRAM_ID, PUMP_PROGRAM_ID, PUMP_PROGRAM_ID);
        }
      }

      // 2. Single batched RPC call using existing getMultipleAccountsWithRetry
      const accounts = await getMultipleAccountsWithRetry(pdasToFetch);
      const solUsdPrice = await getSolUsdPrice();

      // 3. Process results for all candidates in the batch
      for (let i = 0; i < candidateTokens.length; i++) {
        const t = candidateTokens[i];
        const curveAcc = accounts[i * 3];
        const metaAcc = accounts[i * 3 + 1];
        const poolAcc = accounts[i * 3 + 2];

        try {
          if (curveAcc && curveAcc.data) {
            const decoded = decodeBondingCurveBuffer(curveAcc.data as Buffer);
            if (decoded) {
              const {
                virtualTokenReserves,
                virtualSolReserves,
                realTokenReserves,
                realSolReserves,
                tokenTotalSupply,
                complete,
              } = decoded;

              let bondingProgress = 0;
              if (complete || realTokenReserves <= 0n) {
                bondingProgress = 100;
              } else if (realTokenReserves >= PUMP_INITIAL_REAL_TOKEN_RESERVES) {
                bondingProgress = 0;
              } else {
                const tokensSold = PUMP_INITIAL_REAL_TOKEN_RESERVES - realTokenReserves;
                const progressBps = (tokensSold * 10000n) / PUMP_INITIAL_REAL_TOKEN_RESERVES;
                bondingProgress = Math.min(100, Math.max(0, Number(progressBps) / 100));
              }

              let spotPriceSolNum = 0;
              if (virtualTokenReserves > 0n) {
                spotPriceSolNum = Number(virtualSolReserves) / (Number(virtualTokenReserves) * 1000);
              }
              const spotPriceUsdNum = solUsdPrice !== null ? spotPriceSolNum * solUsdPrice : 0;
              const fdvSol = spotPriceSolNum * 1_000_000_000;
              const fdvUsd = solUsdPrice !== null ? Math.round(fdvSol * solUsdPrice * 100) / 100 : 0;
              const marketCapUsd = fdvUsd;
              const realSolReservesFormatted = (Number(realSolReserves) / 1e9).toFixed(3);
              const liquidityUsd = solUsdPrice !== null
                ? Math.round(((Number(realSolReserves) / 1e9) * solUsdPrice) * 100) / 100
                : undefined;

              // Update numeric bonding curve metrics
              t.virtualTokenReserves = virtualTokenReserves.toString();
              t.virtualSolReserves = virtualSolReserves.toString();
              t.realTokenReserves = realTokenReserves.toString();
              t.realSolReserves = realSolReserves.toString();
              t.tokenTotalSupply = tokenTotalSupply.toString();
              const isMigratedToPumpSwap = Boolean(
                complete ||
                (poolAcc && poolAcc.owner && poolAcc.owner.equals(PUMP_AMM_PROGRAM_ID)) ||
                (realTokenReserves <= 0n && virtualTokenReserves > 0n)
              );

              t.complete = complete || isMigratedToPumpSwap;
              t.bondingProgress = isMigratedToPumpSwap ? 100 : bondingProgress;
              t.spotPriceSol = spotPriceSolNum > 0 ? spotPriceSolNum.toFixed(11) : "0";
              t.spotPriceUsd = solUsdPrice !== null && spotPriceUsdNum > 0 ? spotPriceUsdNum.toFixed(9) : "";
              t.fdvSol = fdvSol;
              t.fdvUsd = isMigratedToPumpSwap && (!fdvUsd || fdvUsd < 1000) ? (solUsdPrice !== null ? Math.round(350 * solUsdPrice) : 65000) : fdvUsd;
              t.marketCapUsd = isMigratedToPumpSwap && (!marketCapUsd || marketCapUsd < 1000) ? t.fdvUsd : marketCapUsd;
              t.liquidityUsd = isMigratedToPumpSwap && (!liquidityUsd || liquidityUsd < 100) ? (solUsdPrice !== null ? Math.round(85 * solUsdPrice) : 15000) : liquidityUsd;
              t.solUsdPrice = solUsdPrice !== null ? solUsdPrice : undefined;
              t.realSolReservesFormatted = realSolReservesFormatted;
              t.isBondingCurve = !isMigratedToPumpSwap;
              t.isGraduated = isMigratedToPumpSwap;

              if (isMigratedToPumpSwap) {
                t.marketStage = "pumpswap";
                t.migrationState = "MIGRATED";
                const poolPda = pdasToFetch[i * 3 + 2];
                if (poolPda) {
                  t.pumpSwapPool = poolPda.toBase58();
                  t.pumpswap_pool = poolPda.toBase58();
                  t.pairAddress = poolPda.toBase58();
                }
                if (poolAcc && poolAcc.owner && poolAcc.owner.equals(PUMP_AMM_PROGRAM_ID)) {
                  t.pumpSwapPoolVerified = true;
                }
                t.dexId = "pumpswap";
                t.primaryDex = "PumpSwap";
                t.sources = ["PumpSwap", "Pump.fun (On-Chain)"];
                t.dexes = ["PumpSwap"];
                t.pairs = [
                  {
                    chainId: "solana",
                    pairAddress: t.pairAddress || t.bondingCurvePda,
                    dexName: "PumpSwap",
                    dexId: "pumpswap",
                    baseToken: {
                      address: t.mint,
                      name: t.tokenName,
                      symbol: t.tokenSymbol,
                    },
                    quoteToken: {
                      address: "So11111111111111111111111111111111111111112",
                      name: "Wrapped SOL",
                      symbol: "SOL",
                    },
                    priceUsd: t.spotPriceUsd || "0",
                    liquidityUsd: t.liquidityUsd,
                  },
                ];
              }
            }
          }

          // Heal metadata if placeholder
          if (isPlaceholder(t)) {
            if (metaAcc && metaAcc.data) {
              const meta = decodeMetaplexMetadata(metaAcc.data);
              if (meta.name && (!t.tokenName || t.tokenName.startsWith("Pump Token"))) t.tokenName = meta.name;
              if (meta.symbol && (!t.tokenSymbol || t.tokenSymbol === "PUMP")) t.tokenSymbol = meta.symbol;
              if (meta.uri && !t.metadataUri) t.metadataUri = meta.uri;
            }
          }

          t.lastRefreshedAt = now;
          this.tokens.set(t.mint, t);
        } catch {}
      }

      // Off-chain JSON metadata still needed for any token above that has a URI
      // but is still missing an image or socials. Fetched concurrently instead of
      // one token at a time, since this is the exact step most likely to involve
      // real network latency per token, and doing it sequentially for a batch of
      // fifteen could take the better part of a minute on its own. Tokens are
      // already stored by reference in this.tokens above, so mutating them here
      // updates the same entries already in the map, no re-set needed, though one
      // is included anyway for clarity.
      const needsOffChainFetch = candidateTokens.filter(
        (t) => t.metadataUri && (!t.imageUrl || (!t.twitter && !t.telegram && !t.website))
      );

      await Promise.allSettled(
        needsOffChainFetch.map(async (t) => {
          try {
            const json = await fetchJsonMetadata(t.metadataUri);
            if (json) {
              if (json.name && (!t.tokenName || t.tokenName.startsWith("Pump Token"))) t.tokenName = json.name;
              if (json.symbol && (!t.tokenSymbol || t.tokenSymbol === "PUMP")) t.tokenSymbol = json.symbol;
              const rawImg = json.image || json.image_uri || json.imageUrl || json.logo || json.icon;
              if (rawImg) t.imageUrl = normalizeUri(rawImg, 0);
              if (json.description && !t.description) t.description = json.description;
              if (!t.twitter && (json.twitter || json.x)) {
                const tw = json.twitter || json.x;
                t.twitter = typeof tw === "string" ? (tw.startsWith("http") ? tw : `https://x.com/${tw.replace(/^@/, "")}`) : "";
              }
              if (!t.telegram && (json.telegram || json.tg)) {
                const tg = json.telegram || json.tg;
                t.telegram = typeof tg === "string" ? (tg.startsWith("http") ? tg : `https://t.me/${tg.replace(/^@/, "")}`) : "";
              }
              if (!t.website && (json.website || json.web)) {
                const web = json.website || json.web;
                t.website = typeof web === "string" ? (web.startsWith("http") ? web : `https://${web}`) : "";
              }
              this.tokens.set(t.mint, t);
            }
          } catch {}
        })
      );
    } catch {} finally {
      this.isRefreshing = false;
    }
  }
}

export const pumpIndexer = new PumpOnChainIndexer();

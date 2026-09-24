import { pumpIndexer } from "./pump-engine.js";

// Shared across requests: if the index is empty and multiple requests land at
// once (e.g. right after a server restart, several people opening Fresh Mints
// at the same moment), only the first one actually starts a backfill. Every
// other concurrent request just awaits that same in-flight run instead of
// kicking off its own redundant, expensive backfill in parallel.
let backfillInFlight: Promise<void> | null = null;

function runBackfillOnce(): Promise<void> {
  if (!backfillInFlight) {
    backfillInFlight = pumpIndexer.runBackfill().finally(() => {
      backfillInFlight = null;
    });
  }
  return backfillInFlight;
}

export default async function handler(req: any, res: any) {
  try {
    const tokens = pumpIndexer.getAllTokens();
    if (tokens.length > 0) {
      return res.status(200).json({
        success: true,
        source: "solana-onchain-indexer",
        total: tokens.length,
        tokens,
      });
    }

    // If index is still warming up, run a fast backfill and return
    await runBackfillOnce();
    const refreshedTokens = pumpIndexer.getAllTokens();

    return res.status(200).json({
      success: true,
      source: "solana-onchain-indexer",
      total: refreshedTokens.length,
      tokens: refreshedTokens,
    });
  } catch (err: any) {
    console.error("[API /api/pump-fresh] Error fetching fresh tokens:", err);
    return res.status(500).json({
      success: false,
      error: err.message || "Failed to retrieve fresh Pump.fun tokens",
      tokens: [],
    });
  }
}

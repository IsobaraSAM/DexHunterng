import { Connection } from "@solana/web3.js";
import { resolvePumpLifecycle, PUMP_PROGRAM_ID } from "../providers/pumpLifecycle.js";

// One-token diagnostic, exactly as specified in the migration handoff:
// prove the lifecycle resolver works correctly on a single real mint before
// anything gets scaled up or wired into Fresh Mints reconciliation.
export default async function handler(req: any, res: any) {
  const mint = req.query?.mint as string | undefined;
  if (!mint || !mint.trim()) {
    return res.status(400).json({ error: "Missing required mint query parameter" });
  }

  try {
    const result = await resolvePumpLifecycle(mint.trim());

    let lastCheckedSlot: number | null = null;
    try {
      const rpcUrl =
        process.env.SOLANA_RPC_URL ||
        "https://api.mainnet-beta.solana.com";
      const connection = new Connection(rpcUrl, "confirmed");
      lastCheckedSlot = await connection.getSlot();
    } catch {
      // Slot number is diagnostic sugar only, never block the response on it.
    }

    // Map onto the exact field names requested in the handoff's debug spec,
    // in addition to the richer internal shape from the resolver itself.
    const graduationState =
      result.status === "BONDING"
        ? "NOT_GRADUATED"
        : result.status === "NOT_PUMP_FUN"
        ? "NOT_A_PUMP_TOKEN"
        : "GRADUATED";

    const migrationState =
      result.status === "BONDING"
        ? "NOT_READY"
        : result.status === "GRADUATED_MIGRATION_PENDING"
        ? "MIGRATION_PENDING"
        : result.status === "PUMPSWAP_ACTIVE"
        ? "MIGRATED"
        : result.status === "NOT_PUMP_FUN"
        ? "NOT_APPLICABLE"
        : "UNKNOWN";

    return res.status(200).json({
      mint: result.mint,
      pumpProgram: PUMP_PROGRAM_ID.toBase58(),
      bondingCurve: result.bondingCurve,
      bondingCurveExists: result.bondingCurveExists,
      bondingCurveOwner: result.bondingCurveOwner,
      decoded: result.complete !== null,
      complete: result.complete,
      realTokenReserves: result.realTokenReserves,
      realSolReserves: result.realQuoteReserves,
      bondingProgressPct: result.bondingProgressPct,
      graduationState,
      migrationState,
      // Not populated in this pass: this resolver derives the pool address
      // directly rather than parsing a migrate transaction, so there is no
      // transaction signature to report yet. Left explicit rather than
      // invented, per the handoff's own instruction not to guess this.
      migrationSignature: null,
      pumpSwapPool: result.pumpSwapPool,
      pumpSwapPoolVerified: result.pumpSwapPoolVerified,
      finalMarketStage: result.status,
      lastCheckedSlot,
      error: result.error,
    });
  } catch (error: any) {
    console.error("Error in /api/pumpfun-debug handler:", error);
    return res.status(500).json({ error: error.message || "Internal server error" });
  }
}

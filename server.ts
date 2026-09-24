import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import pumpfunNewHandler from "./api/pumpfun-new.js";
import tokenHoldersHandler from "./api/token-holders.js";
import pumpResolveHandler from "./api/pump-resolve.js";
import pumpFreshHandler from "./api/pump-fresh.js";
import pumpfunDebugHandler from "./api/pumpfun-debug.js";
import pumpfunDiagnosticHandler from "./api/pumpfun-diagnostic.js";
import { pumpIndexer } from "./api/pump-engine.js";
import { discoveryEngine } from "./api/discovery-engine.js";
import { argusIndexer } from "./api/argus-engine.js";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

  app.use(express.json());

  // Health check endpoint
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: Date.now() });
  });

  // API Route for direct on-chain Pump.fun bonding-curve resolution
  app.get("/api/pump-resolve", async (req, res) => {
    try {
      await pumpResolveHandler(req, res);
    } catch (err: any) {
      if (!res.headersSent) {
        res.status(500).json({ error: err.message || "Internal server error" });
      }
    }
  });

  // Alias /api/pump-token
  app.get("/api/pump-token", async (req, res) => {
    try {
      await pumpResolveHandler(req, res);
    } catch (err: any) {
      if (!res.headersSent) {
        res.status(500).json({ error: err.message || "Internal server error" });
      }
    }
  });

  // API Route for live on-chain discovered Fresh Mints
  app.get("/api/pump-fresh", async (req, res) => {
    try {
      await pumpFreshHandler(req, res);
    } catch (err: any) {
      if (!res.headersSent) {
        res.status(500).json({ error: err.message || "Internal server error" });
      }
    }
  });

  // API Route for Pump.fun lifecycle diagnostic (one-token resolver)
  app.get("/api/pumpfun-debug", async (req, res) => {
    try {
      await pumpfunDebugHandler(req, res);
    } catch (err: any) {
      if (!res.headersSent) {
        res.status(500).json({ error: err.message || "Internal server error" });
      }
    }
  });

  // API Route for comprehensive Pump.fun Metaplex & IPFS metadata diagnostic & audit trail
  app.get("/api/pumpfun-diagnostic", async (req, res) => {
    try {
      await pumpfunDiagnosticHandler(req, res);
    } catch (err: any) {
      if (!res.headersSent) {
        res.status(500).json({ error: err.message || "Internal server error" });
      }
    }
  });

  app.get("/api/pump-diagnostic", async (req, res) => {
    try {
      await pumpfunDiagnosticHandler(req, res);
    } catch (err: any) {
      if (!res.headersSent) {
        res.status(500).json({ error: err.message || "Internal server error" });
      }
    }
  });

  app.get("/api/pumpfun-audit", async (req, res) => {
    try {
      await pumpfunDiagnosticHandler(req, res);
    } catch (err: any) {
      if (!res.headersSent) {
        res.status(500).json({ error: err.message || "Internal server error" });
      }
    }
  });

  app.get("/api/pump-audit", async (req, res) => {
    try {
      await pumpfunDiagnosticHandler(req, res);
    } catch (err: any) {
      if (!res.headersSent) {
        res.status(500).json({ error: err.message || "Internal server error" });
      }
    }
  });

  // API Route for Pump.fun fresh mints via Moralis proxy
  app.get("/api/pumpfun-new", async (req, res) => {
    try {
      await pumpfunNewHandler(req, res);
    } catch (err: any) {
      if (!res.headersSent) {
        res.status(500).json({ error: err.message || "Internal server error" });
      }
    }
  });

  // API Route for Solana token top holders & concentration via Moralis proxy
  app.get("/api/token-holders", async (req, res) => {
    try {
      await tokenHoldersHandler(req, res);
    } catch (err: any) {
      if (!res.headersSent) {
        res.status(500).json({ error: err.message || "Internal server error" });
      }
    }
  });

  // API Route: High-Throughput Real-Time Discovery Across All Chains
  app.get("/api/discovery", (req, res) => {
    try {
      const chain = req.query.chain as string;
      const mode = (req.query.mode as any) || "trending";
      const limit = req.query.limit ? Number(req.query.limit) : 1000;
      const minLiquidity = req.query.minLiquidity ? Number(req.query.minLiquidity) : undefined;
      const minVolume = req.query.minVolume ? Number(req.query.minVolume) : undefined;

      const tokens = discoveryEngine.getTokens({ chain, mode, limit, minLiquidity, minVolume });
      res.json({
        success: true,
        total: tokens.length,
        chain: chain || "all",
        mode,
        tokens,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || "Discovery indexing error" });
    }
  });

  // API Route: Real-Time Discovery Engine Telemetry & Index Stats
  app.get("/api/discovery/stats", (_req, res) => {
    try {
      const stats = discoveryEngine.getStats();
      res.json({ success: true, stats });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // API Route: Downloadable / Exportable Data (CSV / JSON)
  app.get("/api/discovery/export", (req, res) => {
    try {
      const format = (req.query.format as string) === "csv" ? "csv" : "json";
      const chain = req.query.chain as string;
      const mode = req.query.mode as any;
      const result = discoveryEngine.exportData(format, chain, mode);
      res.setHeader("Content-Type", result.contentType);
      res.setHeader("Content-Disposition", `attachment; filename="${result.filename}"`);
      res.send(result.data);
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // API Route: Argus Launchpad Tokens (Arc Chain 5042 - Portal #7 & #8)
  app.get("/api/argus/launches", (req, res) => {
    try {
      const portal = req.query.portal ? Number(req.query.portal) : undefined;
      const tier = req.query.tier as string;
      const reusedOnly = req.query.reusedOnly === "true";
      let tokens = argusIndexer.getArgusTokens();

      if (portal) {
        tokens = tokens.filter((t) => t.argusPortalId === portal);
      }
      if (tier) {
        tokens = tokens.filter((t) => t.argusDevBuyTier === tier);
      }
      if (reusedOnly) {
        tokens = tokens.filter((t) => t.argusReusedSocials?.hasReusedSocials);
      }

      res.json({
        success: true,
        total: tokens.length,
        message: "Argus Launchpad tokens on Arc mainnet (Chain 5042)",
        portalsTracked: [7, 8],
        tokens,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || "Failed fetching Argus launches" });
    }
  });

  // API Route: Argus Launchpad Telemetry & Stats
  app.get("/api/argus/stats", (_req, res) => {
    try {
      res.json({ success: true, stats: argusIndexer.getStats() });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.use((req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`DexHunter server running on http://0.0.0.0:${PORT}`);
    // Start continuous on-chain Pump.fun discovery & backfill indexer
    pumpIndexer.start().catch((err) => {
      console.error("[Pump Indexer] Startup error:", err);
    });
    // Start multi-chain high-throughput discovery engine
    discoveryEngine.start().catch((err) => {
      console.error("[Discovery Engine] Startup error:", err);
    });
    // Start native Arc Argus Launchpad engine (Portal #7 & #8)
    argusIndexer.start().catch((err) => {
      console.error("[Argus Indexer] Startup error:", err);
    });
  });
}

startServer();

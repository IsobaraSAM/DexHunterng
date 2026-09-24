import React, { useState, useEffect } from "react";
import { ExternalLink, Globe } from "lucide-react";
import { TokenPair } from "../types";
import { 
  normalizeChainName, 
  normalizeDexName, 
  getDexLogo, 
  getDexTradingUrl, 
  getCanonicalTokenLogo 
} from "../lib/aggregator";
import { normalizeUri, IPFS_GATEWAYS } from "../lib/providers/metaplexMetadata";
import {
  safeHref,
  parseHttpUrl,
  coerceSocialUrl,
  isTwitterHost,
  isTelegramHost,
  isDiscordHost,
  isTrackerHost,
  looksLikeImageUri,
} from "../lib/safeUrl";
import { toMillis } from "../lib/time";
import { hasVerifiedPumpSwapPool, isBondingCurveToken } from "../lib/tokenIdentity";

export const TelegramIcon = ({ className = "w-3.5 h-3.5" }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M21.543 6.498l-3.323 15.666c-.25 1.107-.906 1.38-1.834.861l-5.064-3.733-2.443 2.352c-.27.27-.498.498-1.02.498l.363-5.158 9.387-8.48c.408-.363-.089-.566-.633-.203l-11.603 7.306-5.002-1.564c-1.087-.34-1.109-1.087.227-1.608l19.554-7.535c.905-.34 1.696.204 1.388 1.596z"/>
  </svg>
);

export const XIcon = ({ className = "w-3.5 h-3.5" }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
  </svg>
);

export const DiscordIcon = ({ className = "w-3.5 h-3.5" }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.929 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.894.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
  </svg>
);

function hostnameOfCandidate(raw: string): string | null {
  const direct = parseHttpUrl(raw);
  if (direct) return direct.hostname.toLowerCase();
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || looksLikeImageUri(raw)) return null;
  const withProto = parseHttpUrl(`https://${raw.replace(/^\/\//, "")}`);
  return withProto ? withProto.hostname.toLowerCase() : null;
}

export function extractTokenSocials(pair?: TokenPair | Partial<TokenPair> | null): {
  tgUrl?: string;
  twUrl?: string;
  webUrl?: string;
  discordUrl?: string;
} {
  if (!pair) return {};

  const allCandidates: Array<{ type?: string; url?: string; label?: string }> = [];

  if (Array.isArray(pair.info?.socials)) {
    allCandidates.push(...pair.info.socials);
  }

  if (Array.isArray(pair.info?.websites)) {
    allCandidates.push(...pair.info.websites);
  }

  const p = pair as any;
  if (p.telegram) allCandidates.push({ type: "telegram", url: p.telegram });
  if (p.tg) allCandidates.push({ type: "telegram", url: p.tg });
  if (p.telegram_url) allCandidates.push({ type: "telegram", url: p.telegram_url });

  if (p.twitter) allCandidates.push({ type: "twitter", url: p.twitter });
  if (p.x) allCandidates.push({ type: "twitter", url: p.x });
  if (p.twitter_url) allCandidates.push({ type: "twitter", url: p.twitter_url });
  if (p.x_url) allCandidates.push({ type: "twitter", url: p.x_url });

  if (p.website) allCandidates.push({ type: "website", url: p.website });
  if (p.web) allCandidates.push({ type: "website", url: p.web });
  if (p.website_url) allCandidates.push({ type: "website", url: p.website_url });

  if (p.discord) allCandidates.push({ type: "discord", url: p.discord });
  if (p.discord_url) allCandidates.push({ type: "discord", url: p.discord_url });

  if (Array.isArray(p.socials)) {
    allCandidates.push(...p.socials);
  } else if (p.socials && typeof p.socials === "object") {
    if (p.socials.telegram) allCandidates.push({ type: "telegram", url: p.socials.telegram });
    if (p.socials.tg) allCandidates.push({ type: "telegram", url: p.socials.tg });
    if (p.socials.twitter) allCandidates.push({ type: "twitter", url: p.socials.twitter });
    if (p.socials.x) allCandidates.push({ type: "twitter", url: p.socials.x });
    if (p.socials.website) allCandidates.push({ type: "website", url: p.socials.website });
    if (p.socials.discord) allCandidates.push({ type: "discord", url: p.socials.discord });
  }

  if (Array.isArray(p.links)) {
    allCandidates.push(...p.links);
  } else if (p.links && typeof p.links === "object") {
    if (p.links.telegram) allCandidates.push({ type: "telegram", url: p.links.telegram });
    if (p.links.tg) allCandidates.push({ type: "telegram", url: p.links.tg });
    if (p.links.twitter) allCandidates.push({ type: "twitter", url: p.links.twitter });
    if (p.links.x) allCandidates.push({ type: "twitter", url: p.links.x });
    if (p.links.website) allCandidates.push({ type: "website", url: p.links.website });
    if (p.links.discord) allCandidates.push({ type: "discord", url: p.links.discord });
  }

  if (p.extensions && typeof p.extensions === "object") {
    if (p.extensions.twitter) allCandidates.push({ type: "twitter", url: p.extensions.twitter });
    if (p.extensions.x) allCandidates.push({ type: "twitter", url: p.extensions.x });
    if (p.extensions.telegram) allCandidates.push({ type: "telegram", url: p.extensions.telegram });
    if (p.extensions.website) allCandidates.push({ type: "website", url: p.extensions.website });
    if (p.extensions.discord) allCandidates.push({ type: "discord", url: p.extensions.discord });
  }

  if (Array.isArray(p.attributes)) {
    for (const attr of p.attributes) {
      if (attr && (attr.value || attr.url)) {
        allCandidates.push({ type: attr.trait_type || attr.name || attr.type, url: attr.value || attr.url });
      }
    }
  }

  const descText = String(p.description || pair.info?.description || (p.info as any)?.description || "");
  if (descText) {
    const tgMatch = descText.match(/(?:https?:\/\/)?(?:t\.me|telegram\.me)\/([a-zA-Z0-9_+]+)/i);
    if (tgMatch) allCandidates.push({ type: "telegram", url: `https://t.me/${tgMatch[1]}` });

    const twMatch = descText.match(/(?:https?:\/\/|\/\/|\s|^)(?:www\.)?(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]{1,30})/i);
    if (twMatch && !["home", "share", "intent", "search"].includes(twMatch[1].toLowerCase())) {
      allCandidates.push({ type: "twitter", url: `https://x.com/${twMatch[1]}` });
    }

    const discordMatch = descText.match(/(?:https?:\/\/)?(?:discord\.gg|discord\.com\/invite)\/([a-zA-Z0-9-_]+)/i);
    if (discordMatch) allCandidates.push({ type: "discord", url: `https://discord.gg/${discordMatch[1]}` });

    const urlMatches = descText.match(/https?:\/\/[^\s)]+/gi) || [];
    for (const rawUrl of urlMatches) {
      const parsed = parseHttpUrl(rawUrl);
      if (!parsed) continue;
      const host = parsed.hostname.toLowerCase();
      if (isTelegramHost(host) || isTwitterHost(host) || isDiscordHost(host) || isTrackerHost(host)) continue;
      if (looksLikeImageUri(rawUrl)) continue;
      allCandidates.push({ type: "website", url: parsed.toString() });
    }
  }

  let tgUrl: string | undefined;
  let twUrl: string | undefined;
  let webUrl: string | undefined;
  let discordUrl: string | undefined;

  for (const c of allCandidates) {
    if (!c || !c.url || typeof c.url !== "string") continue;
    const raw = c.url.trim();
    if (!raw || raw === "null" || raw === "undefined") continue;

    const typeLower = (c.type || "").toLowerCase();
    const labelLower = (c.label || "").toLowerCase();
    const host = hostnameOfCandidate(raw);

    const typedTelegram = typeLower === "telegram" || typeLower === "tg" || labelLower.includes("telegram");
    const typedTwitter = typeLower === "twitter" || typeLower === "x" || labelLower.includes("twitter");
    const typedDiscord = typeLower === "discord" || labelLower.includes("discord");
    const typedWebsite = typeLower === "website" || typeLower === "web" || labelLower.includes("website");

    if (!tgUrl && (typedTelegram || (host && isTelegramHost(host)))) {
      tgUrl = coerceSocialUrl(raw, "telegram");
      continue;
    }

    if (!twUrl && (typedTwitter || (host && isTwitterHost(host)))) {
      twUrl = coerceSocialUrl(raw, "twitter");
      continue;
    }

    if (!discordUrl && (typedDiscord || (host && isDiscordHost(host)))) {
      discordUrl = coerceSocialUrl(raw, "discord");
      continue;
    }

    if (!webUrl && (typedWebsite || (!typedTelegram && !typedTwitter && !typedDiscord))) {
      if (looksLikeImageUri(raw)) continue;
      if (host && (isTwitterHost(host) || isTelegramHost(host) || isDiscordHost(host) || isTrackerHost(host))) continue;
      webUrl = coerceSocialUrl(raw, "website");
    }
  }

  return { tgUrl, twUrl, webUrl, discordUrl };
}

function SocialAnchor({
  url,
  className,
  title,
  ariaLabel,
  children,
}: {
  url?: string;
  className: string;
  title: string;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  if (!url) return null;
  const href = safeHref(url);
  if (!href) {
    return (
      <span className={className} title={title} aria-label={ariaLabel}>
        {children}
      </span>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={className}
      title={title}
      aria-label={ariaLabel}
    >
      {children}
    </a>
  );
}

export const SocialLinksRow = ({
  pair,
  className = "",
  size = "md",
}: {
  pair?: TokenPair | Partial<TokenPair> | null;
  className?: string;
  size?: "sm" | "md" | "micro" | "compact";
}) => {
  const socials = extractTokenSocials(pair);
  const hasAnySocial = Boolean(socials.tgUrl || socials.twUrl || socials.webUrl || socials.discordUrl);

  if (!hasAnySocial) {
    if (size === "micro" || size === "compact") return null;
    return (
      <span className={`text-[10px] text-zinc-500/70 font-mono italic ${className}`}>
        No socials listed
      </span>
    );
  }

  const btnClass = size === "micro"
    ? "w-5.5 h-5.5 min-w-[22px] min-h-[22px] max-w-[22px] max-h-[22px] rounded-md border border-slate-200/80 dark:border-zinc-800 bg-slate-100/90 dark:bg-[#181926] hover:-translate-y-0.5 hover:scale-105 active:scale-95 transition-all duration-150 cursor-pointer flex items-center justify-center flex-shrink-0 aspect-square shadow-2xs relative before:absolute before:-inset-1.5 sm:before:hidden touch-manipulation"
    : size === "compact"
    ? "w-6.5 h-6.5 min-w-[26px] min-h-[26px] max-w-[26px] max-h-[26px] rounded-lg border border-slate-200/90 dark:border-zinc-800 bg-slate-100/90 dark:bg-[#181926] hover:-translate-y-0.5 hover:scale-105 active:scale-95 transition-all duration-150 cursor-pointer flex items-center justify-center flex-shrink-0 aspect-square shadow-2xs relative before:absolute before:-inset-1.5 sm:before:hidden touch-manipulation"
    : size === "sm"
    ? "w-7 h-7 min-w-[28px] min-h-[28px] max-w-[28px] max-h-[28px] rounded-lg border border-slate-200/90 dark:border-zinc-800 bg-slate-100/90 dark:bg-[#181926] hover:-translate-y-0.5 hover:scale-105 active:scale-95 transition-all duration-150 cursor-pointer flex items-center justify-center flex-shrink-0 aspect-square shadow-2xs relative before:absolute before:-inset-2 sm:before:hidden touch-manipulation"
    : "w-8 h-8 min-w-[32px] min-h-[32px] max-w-[32px] max-h-[32px] rounded-xl border border-slate-200/90 dark:border-zinc-800 bg-slate-100/90 dark:bg-[#181926] hover:-translate-y-0.5 hover:scale-105 active:scale-95 transition-all duration-150 cursor-pointer flex items-center justify-center flex-shrink-0 aspect-square shadow-2xs relative before:absolute before:-inset-2 sm:before:hidden touch-manipulation";

  const iconClass = size === "micro"
    ? "w-3 h-3 min-w-[12px] min-h-[12px] flex-shrink-0"
    : size === "compact"
    ? "w-3.5 h-3.5 min-w-[14px] min-h-[14px] flex-shrink-0"
    : size === "sm"
    ? "w-4 h-4 min-w-[16px] min-h-[16px] flex-shrink-0"
    : "w-4.5 h-4.5 min-w-[18px] min-h-[18px] flex-shrink-0";

  return (
    <div className={`flex items-center ${size === "micro" ? "gap-1" : size === "compact" ? "gap-1" : "gap-1.5"} ${className}`} role="group" aria-label="Social Links" onClick={(e) => e.stopPropagation()}>
      <SocialAnchor
        url={socials.tgUrl}
        className={`${btnClass} text-[#229ED9] hover:bg-[#229ED9]/15 hover:border-[#229ED9]/60 hover:text-[#38b7f3] hover:shadow-xs hover:shadow-[#229ED9]/20`}
        title="Telegram Community"
        ariaLabel="Telegram"
      >
        <TelegramIcon className={iconClass} />
      </SocialAnchor>
      <SocialAnchor
        url={socials.twUrl}
        className={`${btnClass} text-slate-800 dark:text-zinc-100 hover:bg-slate-200/70 dark:hover:bg-zinc-800/90 hover:border-slate-400 dark:hover:border-zinc-500 hover:text-black dark:hover:text-white hover:shadow-xs`}
        title="X (Twitter)"
        ariaLabel="X (Twitter)"
      >
        <XIcon className={iconClass} />
      </SocialAnchor>
      <SocialAnchor
        url={socials.webUrl}
        className={`${btnClass} text-emerald-500 dark:text-emerald-400 hover:bg-emerald-500/15 hover:border-emerald-500/60 hover:text-emerald-400 dark:hover:text-emerald-300 hover:shadow-xs hover:shadow-emerald-500/20`}
        title="Official Website"
        ariaLabel="Website"
      >
        <Globe className={iconClass} />
      </SocialAnchor>
      <SocialAnchor
        url={socials.discordUrl}
        className={`${btnClass} text-[#5865F2] hover:bg-[#5865F2]/15 hover:border-[#5865F2]/60 hover:text-[#7289da] hover:shadow-xs hover:shadow-[#5865F2]/20`}
        title="Discord Server"
        ariaLabel="Discord"
      >
        <DiscordIcon className={iconClass} />
      </SocialAnchor>
    </div>
  );
};

export const TokenImage = ({ 
  imageUrl, 
  symbol, 
  address, 
  chainId,
  className = "w-7 h-7 sm:w-8 sm:h-8"
}: { 
  imageUrl?: string; 
  symbol?: string; 
  address?: string; 
  chainId?: string; 
  className?: string;
}) => {
  const [gatewayIdx, setGatewayIdx] = useState(0);
  const [useFallbackCdn, setUseFallbackCdn] = useState(false);
  const [imgError, setImgError] = useState(false);
  const firstLetter = symbol ? symbol.charAt(0).toUpperCase() : "?";

  const canonicalUrl = getCanonicalTokenLogo(chainId, address, symbol);

  useEffect(() => {
    setImgError(false);
    setGatewayIdx(0);
    setUseFallbackCdn(false);
  }, [imageUrl, address, canonicalUrl]);

  const normChain = chainId?.toLowerCase() === "polygon_pos" ? "polygon" : (chainId?.toLowerCase() || "solana");
  const cdnUrl = address ? `https://dd.dexscreener.com/ds-data/tokens/${normChain}/${address}.png` : undefined;

  const normalizedProvidedImage = imageUrl ? normalizeUri(imageUrl, gatewayIdx) : undefined;
  const currentSrc = canonicalUrl || (!useFallbackCdn && normalizedProvidedImage ? normalizedProvidedImage : cdnUrl);

  if (!currentSrc || imgError) {
    return (
      <div 
        className={`${className} rounded-xl bg-slate-100 dark:bg-[#1c1d2c] border border-slate-200 dark:border-zinc-700/50 flex items-center justify-center font-mono text-xs font-bold text-[#ff6b35] flex-shrink-0 select-none aspect-square`} 
        title={symbol}
      >
        {firstLetter}
      </div>
    );
  }

  return (
    <div className={`${className} rounded-xl bg-slate-100 dark:bg-[#181926] border border-slate-200/80 dark:border-zinc-700/60 p-0.5 flex items-center justify-center flex-shrink-0 overflow-hidden aspect-square`}>
      <img
        src={currentSrc}
        alt={symbol || "Token Logo"}
        referrerPolicy="no-referrer"
        onError={() => {
          if (imageUrl && (imageUrl.includes("ipfs") || imageUrl.startsWith("Qm") || imageUrl.startsWith("bafy")) && gatewayIdx < IPFS_GATEWAYS.length - 1) {
            setGatewayIdx((prev) => prev + 1);
          } else if (!canonicalUrl && !useFallbackCdn && cdnUrl && currentSrc !== cdnUrl) {
            setUseFallbackCdn(true);
          } else {
            setImgError(true);
          }
        }}
        className="w-full h-full object-contain rounded-lg flex-shrink-0"
      />
    </div>
  );
};

export const ChainIcon = ({ chainId, fallbackClass }: { chainId: string; fallbackClass?: string }) => {
  const [imgError, setImgError] = useState(false);
  const norm = normalizeChainName(chainId);
  
  const cdnUrls: Record<string, string> = {
    solana: "https://dd.dexscreener.com/ds-data/chains/solana.png",
    bsc: "https://dd.dexscreener.com/ds-data/chains/bsc.png",
    ethereum: "https://dd.dexscreener.com/ds-data/chains/ethereum.png",
    base: "https://dd.dexscreener.com/ds-data/chains/base.png",
    arbitrum: "https://dd.dexscreener.com/ds-data/chains/arbitrum.png",
    polygon: "https://dd.dexscreener.com/ds-data/chains/polygon.png",
    avalanche: "https://dd.dexscreener.com/ds-data/chains/avalanche.png",
    cronos: "https://dd.dexscreener.com/ds-data/chains/cronos.png",
    robinhood: "https://dd.dexscreener.com/ds-data/chains/robinhood.png",
  };

  const logoUrl = cdnUrls[norm] || (norm ? `https://dd.dexscreener.com/ds-data/chains/${norm}.png` : undefined);

  if (!logoUrl || imgError) {
    return (
      <span className={`text-[9px] sm:text-[10px] font-semibold px-1.5 py-0.5 border rounded-md ${fallbackClass || "bg-zinc-800 text-zinc-300 border-zinc-700"}`}>
        {chainId?.toUpperCase() || "UNKNOWN"}
      </span>
    );
  }

  return (
    <img
      src={logoUrl}
      alt={chainId}
      title={chainId.toUpperCase()}
      onError={() => setImgError(true)}
      referrerPolicy="no-referrer"
      className="w-4 h-4 sm:w-[18px] sm:h-[18px] object-contain flex-shrink-0 rounded-full"
    />
  );
};

export const DexProtocolBadge = ({ pair }: { pair: TokenPair }) => {
  const isPumpSwap = hasVerifiedPumpSwapPool(pair);
  const isPumpBonding = isBondingCurveToken(pair) && !isPumpSwap;
  const progress = typeof pair.bondingProgress === "number" ? Math.min(100, Math.max(0, pair.bondingProgress)) : null;

  if (isPumpBonding) {
    const tradeUrl = safeHref(
      getDexTradingUrl(pair, "Pump.fun") || (pair.baseToken?.address ? `https://pump.fun/coin/${pair.baseToken.address}` : undefined)
    );
    const className = "inline-flex items-center gap-1 text-[10.5px] font-mono font-bold px-2 py-0.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:border-emerald-500/60 hover:bg-emerald-500/20 transition cursor-pointer group shadow-2xs whitespace-nowrap";
    const title = `Pump.fun Bonding Curve (${progress !== null ? `${progress}% complete` : "Active"})`;
    const inner = (
      <>
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse flex-shrink-0" />
        <span className="truncate">Bonding Curve</span>
        {progress !== null && (
          <span className="px-1 py-0.2 rounded bg-emerald-500/20 text-[10px] font-mono">
            {progress.toFixed(0)}%
          </span>
        )}
        <ExternalLink className="w-2.5 h-2.5 opacity-60 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
      </>
    );
    if (!tradeUrl) {
      return (
        <span title={title} className={className}>
          {inner}
        </span>
      );
    }
    return (
      <a
        href={tradeUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        title={title}
        className={className}
      >
        {inner}
      </a>
    );
  }

  let dexName = isPumpSwap ? "PumpSwap" : pair.primaryDex;
  if (!dexName) {
    dexName = normalizeDexName(pair.dexId || pair.primaryProvider);
  }
  const logoUrl = (dexName === "PumpSwap" ? getDexLogo("pumpswap") : pair.primaryDexLogo) || getDexLogo(dexName || (pair.launchPlatform === "Pump.fun" ? "pumpfun" : "dex"));
  const tradeUrl = safeHref(pair.primaryDexTradingUrl || getDexTradingUrl(pair, dexName) || pair.url);
  const className = "inline-flex items-center gap-1.5 text-[10.5px] font-mono font-bold px-2 py-0.5 rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-100 dark:bg-[#181926] text-slate-700 dark:text-zinc-200 hover:border-[#ff6b35]/60 hover:text-[#ff6b35] transition cursor-pointer group shadow-2xs whitespace-nowrap";
  const title = `Trade on ${dexName || "DEX"}`;
  const inner = (
    <>
      {logoUrl ? (
        <img
          src={logoUrl}
          alt={dexName || "DEX"}
          referrerPolicy="no-referrer"
          className="w-3.5 h-3.5 object-contain rounded-full flex-shrink-0"
          onError={(e) => {
            (e.target as HTMLElement).style.display = "none";
          }}
        />
      ) : (
        <span className="w-1.5 h-1.5 rounded-full bg-[#ff6b35] flex-shrink-0" />
      )}
      <span className="truncate max-w-[85px]">{dexName || "DEX"}</span>
      <ExternalLink className="w-2.5 h-2.5 opacity-50 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
    </>
  );

  if (!tradeUrl) {
    return (
      <span title={title} className={className}>
        {inner}
      </span>
    );
  }

  return (
    <a
      href={tradeUrl}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      title={title}
      className={className}
    >
      {inner}
    </a>
  );
};

export const DexIconContainer = ({ 
  pair, 
  size = "md" 
}: { 
  pair: TokenPair; 
  size?: "sm" | "md"; 
}) => {
  const [imgError, setImgError] = useState(false);
  const isPumpSwap = hasVerifiedPumpSwapPool(pair);
  const isPumpBonding = isBondingCurveToken(pair) && !isPumpSwap;

  let dexName = isPumpSwap ? "PumpSwap" : pair.primaryDex;
  if (!dexName) {
    dexName = isPumpBonding ? "Pump.fun" : normalizeDexName(pair.dexId || pair.primaryProvider);
  }

  const logoUrl = (dexName === "PumpSwap" ? getDexLogo("pumpswap") : pair.primaryDexLogo) || getDexLogo(dexName || (isPumpBonding ? "pumpfun" : "dex"));
  
  const rawTradeUrl = isPumpBonding 
    ? (getDexTradingUrl(pair, "Pump.fun") || (pair.baseToken?.address ? `https://pump.fun/coin/${pair.baseToken.address}` : undefined))
    : ((dexName === "PumpSwap" ? getDexTradingUrl(pair, "PumpSwap") : pair.primaryDexTradingUrl) || getDexTradingUrl(pair, dexName) || pair.url);
  const tradeUrl = safeHref(rawTradeUrl);

  const containerClass = size === "sm"
    ? "w-7 h-7 min-w-[28px] min-h-[28px] max-w-[28px] max-h-[28px] rounded-lg overflow-hidden aspect-square"
    : "w-8 h-8 min-w-[32px] min-h-[32px] max-w-[32px] max-h-[32px] rounded-xl overflow-hidden aspect-square";
  const imgClass = size === "sm"
    ? "w-4 h-4 min-w-[16px] min-h-[16px] max-w-[16px] max-h-[16px]"
    : "w-5 h-5 min-w-[20px] min-h-[20px] max-w-[20px] max-h-[20px]";

  const className = `${containerClass} p-1 border border-slate-200/90 dark:border-zinc-800 bg-slate-100/90 dark:bg-[#181926] shadow-2xs hover:border-[#ff6b35]/60 hover:bg-[#ff6b35]/10 hover:scale-105 active:scale-95 transition-all duration-150 flex items-center justify-center flex-shrink-0 aspect-square cursor-pointer group relative before:absolute before:-inset-2 sm:before:hidden touch-manipulation`;
  const inner = logoUrl && !imgError ? (
    <img
      src={logoUrl}
      alt={dexName || "DEX"}
      referrerPolicy="no-referrer"
      onError={() => setImgError(true)}
      className={`${imgClass} object-contain flex-shrink-0 group-hover:scale-110 transition-transform duration-150`}
    />
  ) : (
    <span className="font-mono text-[9px] font-bold text-zinc-400 group-hover:text-[#ff6b35] uppercase truncate">
      {(dexName || "DEX").slice(0, 3)}
    </span>
  );

  if (!tradeUrl) {
    return (
      <span
        title={`Trade on ${dexName || "DEX"}`}
        aria-label={`Trade on ${dexName || "DEX"}`}
        className={className}
      >
        {inner}
      </span>
    );
  }

  return (
    <a
      href={tradeUrl}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      title={`Trade on ${dexName || "DEX"}`}
      aria-label={`Trade on ${dexName || "DEX"}`}
      className={className}
    >
      {inner}
    </a>
  );
};

export const DexProviderButton = ({ pair }: { pair: TokenPair }) => {
  const pairOrAddress = pair.pairAddress || pair.baseToken?.address;
  const chartUrl = safeHref(
    pairOrAddress
      ? `https://dexscreener.com/${normalizeChainName(pair.chainId)}/${pairOrAddress}`
      : undefined
  );

  if (!chartUrl) return null;

  return (
    <a
      href={chartUrl}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      title="Open DexScreener Chart & Pair Analytics"
      aria-label="DexScreener Chart"
      className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl border border-slate-200/80 dark:border-zinc-800/80 bg-[#F8F9FC] dark:bg-[#1C1C24] shadow-2xs hover:-translate-y-0.5 hover:scale-105 hover:border-sky-500/50 hover:bg-sky-500/10 hover:shadow-xs active:scale-95 transition-all duration-200 ease-out cursor-pointer flex items-center justify-center group flex-shrink-0 relative before:absolute before:-inset-2 sm:before:hidden touch-manipulation"
    >
      <img 
        src="https://dexscreener.com/favicon.ico" 
        alt="DexScreener Chart" 
        className="w-3.5 h-3.5 object-contain opacity-70 group-hover:opacity-100 group-hover:scale-110 transition-transform duration-200"
        onError={(e) => {
          (e.target as HTMLElement).style.display = "none";
        }}
      />
    </a>
  );
};

export const getChainBadgeStyle = (chainId?: string) => {
  const norm = normalizeChainName(chainId);
  if (norm === "solana") return { bg: "bg-[#1f1937] text-[#9945ff] border-[#392b63]", text: "SOLANA" };
  if (norm === "base") return { bg: "bg-[#101b33] text-[#0052ff] border-[#1a2f5a]", text: "BASE" };
  if (norm === "ethereum") return { bg: "bg-[#192429] text-[#627eea] border-[#293d4a]", text: "ETHEREUM" };
  if (norm === "bsc") return { bg: "bg-[#2b2413] text-[#f3ba2f] border-[#4d3e1d]", text: "BNB CHAIN" };
  if (norm === "robinhood") return { bg: "bg-[#102418] text-[#00c805] border-[#1b4322]", text: "ROBINHOOD" };
  if (norm === "arbitrum") return { bg: "bg-[#111e2e] text-[#28a0f0] border-[#1e344e]", text: "ARBITRUM" };
  if (norm === "polygon") return { bg: "bg-[#1a102b] text-[#9d5bf0] border-[#331c59]", text: "POLYGON" };
  if (norm === "avalanche") return { bg: "bg-[#241215] text-[#e84142] border-[#4d1f23]", text: "AVALANCHE" };
  if (norm === "cronos") return { bg: "bg-[#0b1626] text-[#1199fa] border-[#162c4c]", text: "CRONOS" };
  return { bg: "bg-[#181818] text-gray-400 border-[#2a2a2a]", text: chainId?.toUpperCase() || "UNKNOWN" };
};

export const formatTimeAgo = (timestampMs?: number | string) => {
  const ts = toMillis(timestampMs);
  if (!ts) return null;
  
  const diffMs = Date.now() - ts;
  if (diffMs <= 0) return "Just now";
  
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) {
    const remainingMin = diffMin % 60;
    return `${diffHr}h ${remainingMin}m ago`;
  }
  
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) {
    const remainingHr = diffHr % 24;
    return remainingHr > 0 ? `${diffDay}d ${remainingHr}h ago` : `${diffDay}d ago`;
  }
  
  const diffMonth = Math.floor(diffDay / 30);
  if (diffMonth < 12) {
    const remDays = diffDay % 30;
    return remDays > 0 ? `${diffMonth}mo ${remDays}d ago` : `${diffMonth}mo ago`;
  }
  
  const diffYear = Math.floor(diffDay / 365);
  const remMonths = Math.floor((diffDay % 365) / 30);
  return remMonths > 0 ? `${diffYear}y ${remMonths}mo ago` : `${diffYear}y ago`;
};

export const formatExactDate = (timestampMs?: number | string) => {
  const ts = toMillis(timestampMs);
  if (!ts) return undefined;
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short"
  });
};

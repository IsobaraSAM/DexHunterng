import React from "react";

const SUB_DIGITS: Record<string, string> = {
  "0": "₀",
  "1": "₁",
  "2": "₂",
  "3": "₃",
  "4": "₄",
  "5": "₅",
  "6": "₆",
  "7": "₇",
  "8": "₈",
  "9": "₉",
};

export function toSubscriptString(num: number | string): string {
  return String(num)
    .split("")
    .map((ch) => SUB_DIGITS[ch] || ch)
    .join("");
}

export interface FormattedPriceParts {
  prefix?: string;
  subscript?: number;
  suffix?: string;
  formatted?: string;
  isSubscript: boolean;
  rawStr: string;
  fullDecimal?: string;
}

/**
 * Parses a price value and computes subscript notation for small coin prices (e.g. $0.0⁵43 for 0.00000043)
 */
export function formatPriceParts(val: number | string | undefined | null): FormattedPriceParts {
  if (val === null || val === undefined || val === "" || val === "N/A") {
    return { formatted: "N/A", isSubscript: false, rawStr: "N/A" };
  }

  const num = typeof val === "number" ? val : Number(val);
  if (isNaN(num) || num <= 0) {
    return { formatted: "N/A", isSubscript: false, rawStr: "N/A" };
  }

  if (num >= 1000) {
    const formatted = "$" + num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return { formatted, isSubscript: false, rawStr: formatted, fullDecimal: formatted };
  }

  if (num >= 1) {
    const formatted = "$" + num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
    return { formatted, isSubscript: false, rawStr: formatted, fullDecimal: formatted };
  }

  // Value is between 0 and 1. Get exact decimal string without scientific notation
  let str: string;
  if (typeof val === "string" && !val.includes("e") && !val.includes("E") && val.startsWith("0.")) {
    str = val;
  } else {
    str = num.toFixed(20);
  }

  const match = str.match(/^0\.(0+)([1-9][0-9]*)/);
  if (match) {
    const totalZeros = match[1].length;
    const sigDigits = match[2];
    // Keep up to 4 significant digits
    const fourSig = sigDigits.slice(0, 4);
    const fullDecimalStr = "$" + str.slice(0, totalZeros + 6).replace(/0+$/, "");

    // For up to 4 leading zeros (e.g. $0.00002896, $0.0002896, $0.00289, $0.0289),
    // format unambiguously as a readable decimal without subscript confusion
    if (totalZeros <= 4) {
      const decimals = totalZeros + 4;
      const formatted = "$" + num.toFixed(decimals).replace(/0+$/, "");
      return { formatted, isSubscript: false, rawStr: formatted, fullDecimal: formatted };
    } else {
      // For 5 or more leading zeros (e.g. 0.00000123), use compact subscript with tap-to-expand
      const subCount = totalZeros - 1;
      const rawStr = `$0.0${toSubscriptString(subCount)}${fourSig}`;
      return {
        prefix: "$0.0",
        subscript: subCount,
        suffix: fourSig,
        isSubscript: true,
        rawStr,
        fullDecimal: fullDecimalStr,
      };
    }
  }

  const formatted = "$" + num.toFixed(4);
  return { formatted, isSubscript: false, rawStr: formatted, fullDecimal: formatted };
}

/**
 * Returns plain string formatted price with unicode subscript for text-only contexts
 */
export function formatPriceString(val: number | string | undefined | null): string {
  const parts = formatPriceParts(val);
  if (parts.isSubscript) {
    return parts.rawStr;
  }
  return parts.formatted || "N/A";
}

interface FormattedPriceProps {
  value: number | string | undefined | null;
  className?: string;
  prefixDollar?: boolean;
}

/**
 * React Component that renders coin prices with unambiguous decimal representation,
 * or compact subscript notation with tap/click toggle for extreme micro-prices.
 */
export const FormattedPrice: React.FC<FormattedPriceProps> = ({
  value,
  className = "",
  prefixDollar = true,
}) => {
  const [showFull, setShowFull] = React.useState(false);
  const parts = formatPriceParts(value);

  if (parts.isSubscript && parts.prefix && parts.subscript && parts.suffix) {
    if (showFull && parts.fullDecimal) {
      const fullDisplay = prefixDollar ? parts.fullDecimal : parts.fullDecimal.replace(/^\$/, "");
      return (
        <span
          className={`inline-flex items-baseline font-mono tracking-tight cursor-pointer select-all underline decoration-dotted decoration-emerald-500/50 hover:opacity-85 transition-opacity ${className}`}
          title={`Click to view compact notation (${parts.rawStr})`}
          onClick={(e) => {
            e.stopPropagation();
            setShowFull(false);
          }}
        >
          {fullDisplay}
        </span>
      );
    }

    const prefix = prefixDollar ? parts.prefix : parts.prefix.replace(/^\$/, "");
    return (
      <span
        className={`inline-flex items-baseline font-mono tracking-tight cursor-pointer hover:opacity-85 transition-opacity ${className}`}
        title={parts.fullDecimal ? `Tap or click to view full decimal (${parts.fullDecimal})` : `$${value}`}
        onClick={(e) => {
          e.stopPropagation();
          setShowFull(true);
        }}
      >
        <span>{prefix}</span>
        <sub className="text-[0.68em] leading-none font-bold align-sub opacity-85 px-[0.5px] select-all -translate-y-[-0.08em]">
          {parts.subscript}
        </sub>
        <span>{parts.suffix}</span>
      </span>
    );
  }

  const formatted = parts.formatted || "N/A";
  const display = prefixDollar ? formatted : formatted.replace(/^\$/, "");

  return (
    <span className={`font-mono tracking-tight ${className}`} title={value ? `$${value}` : undefined}>
      {display}
    </span>
  );
};

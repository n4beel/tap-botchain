import { formatUnits, zeroAddress, type Address, type PublicClient } from "viem";
import { tapAbi } from "./botchain/abi";
import { erc20Abi } from "./erc20";
import { ONCE } from "./limits";

export interface TapView {
  id: bigint;
  owner: Address;
  token: Address;
  perDraw: bigint;
  balance: bigint;
  cooldown: bigint;
  draws: number;
  createdBlock: bigint;
}

export type TapPhase = "canDraw" | "cooldown" | "used" | "empty";

/**
 * Calculates UTF-8 byte length for input validation against contract limits.
 */
export function byteLength(str: string): number {
  return new TextEncoder().encode(str).length;
}

/**
 * Human-readable format of cooldown durations.
 */
export function describeCooldown(seconds: bigint | number): string {
  const s = BigInt(seconds);
  if (s === ONCE) return "Once ever";
  if (s < 60n) return `${s}s`;
  if (s < 3600n) {
    const mins = Number(s) / 60;
    return `${mins % 1 === 0 ? mins : mins.toFixed(1)} min`;
  }
  if (s < 86400n) {
    const hrs = Number(s) / 3600;
    return `${hrs % 1 === 0 ? hrs : hrs.toFixed(1)} hr`;
  }
  if (s < 604800n) {
    const days = Number(s) / 86400;
    return `${days % 1 === 0 ? days : days.toFixed(1)} ${days === 1 ? "day" : "days"}`;
  }
  const weeks = Number(s) / 604800;
  return `${weeks % 1 === 0 ? weeks : weeks.toFixed(1)} ${weeks === 1 ? "week" : "weeks"}`;
}

/**
 * Formats a token or native draw amount nicely.
 */
export function formatDraw(perDraw: bigint, decimals: number, symbol: string): string {
  const formatted = formatUnits(perDraw, decimals);
  // Strip trailing zeros after decimal point if present
  const clean = formatted.includes(".") ? formatted.replace(/\.?0+$/, "") : formatted;
  return `${clean} ${symbol}`;
}

/**
 * Computes remaining draws in the tap pool.
 */
export function drawsLeft(balance: bigint, perDraw: bigint): bigint {
  if (perDraw === 0n) return 0n;
  return balance / perDraw;
}

/**
 * Computes 0..1 readiness fraction for countdown / liquid fill visualization.
 * 1 means ready to draw, 0 means just drew.
 */
export function levelFraction(
  nextAt: bigint | number,
  cooldown: bigint | number,
  now?: number
): number {
  const n = BigInt(nextAt);
  const cd = BigInt(cooldown);

  if (n === 0n) return 1;
  if (n === ONCE) return 0;
  if (cd === 0n || cd === ONCE) return 0;

  const current = now ?? Math.floor(Date.now() / 1000);
  const nextSec = Number(n);
  const cdSec = Number(cd);

  if (current >= nextSec) return 1;

  const remaining = nextSec - current;
  const elapsed = cdSec - remaining;
  return Math.max(0, Math.min(1, elapsed / cdSec));
}

/**
 * Determines current interaction state for a wallet on a tap.
 */
export function phase(
  tap: Pick<TapView, "balance" | "perDraw" | "cooldown">,
  nextAt: bigint | number,
  now?: number
): TapPhase {
  if (tap.balance < tap.perDraw) {
    return "empty";
  }

  const n = BigInt(nextAt);
  if (n === ONCE) {
    return "used";
  }

  const current = now ?? Math.floor(Date.now() / 1000);
  if (n > 0n && n > BigInt(current)) {
    return "cooldown";
  }

  return "canDraw";
}

/**
 * Cache for tap names so we don't query logs repeatedly for the same tap.
 */
const tapNameCache = new Map<string, string>();

/**
 * Loads tap name from the single-block TapCreated event log.
 */
export async function loadTapName(
  client: PublicClient,
  contractAddress: Address,
  id: bigint | number,
  createdBlock: bigint | number
): Promise<string> {
  const cacheKey = `${contractAddress}:${id}`;
  const cached = tapNameCache.get(cacheKey);
  if (cached !== undefined) return cached;

  try {
    const blockNum = BigInt(createdBlock);
    if (blockNum <= 0n) return `Tap #${id}`;

    const logs = await client.getLogs({
      address: contractAddress,
      event: tapAbi.find((item) => item.type === "event" && item.name === "TapCreated") as any,
      args: { id: BigInt(id) },
      fromBlock: blockNum,
      toBlock: blockNum,
    });

    if (logs.length > 0 && (logs[0] as any).args?.name) {
      const name = (logs[0] as any).args.name as string;
      tapNameCache.set(cacheKey, name);
      return name;
    }
  } catch {
    // Log load failures fall back cleanly
  }

  const fallback = `Tap #${id}`;
  tapNameCache.set(cacheKey, fallback);
  return fallback;
}

/**
 * Fetches token metadata with standard fallbacks.
 */
export async function tokenMeta(
  client: PublicClient,
  tokenAddress: Address
): Promise<{ symbol: string; decimals: number; name: string }> {
  if (tokenAddress === zeroAddress) {
    return { symbol: "BOT", decimals: 18, name: "BOT Chain Native" };
  }

  try {
    const [symbol, decimals, name] = await Promise.all([
      client.readContract({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: "symbol",
      }).catch(() => "TOKEN"),
      client.readContract({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: "decimals",
      }).catch(() => 18),
      client.readContract({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: "name",
      }).catch(() => "ERC-20 Token"),
    ]);

    return {
      symbol: symbol as string,
      decimals: Number(decimals),
      name: name as string,
    };
  } catch {
    return { symbol: "TOKEN", decimals: 18, name: "ERC-20 Token" };
  }
}

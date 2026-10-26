export type TapFundingStep = "approve" | "create" | "fundToken";

export interface PlanParams {
  assetType: "native" | "token";
  initialFund: bigint;
  allowance?: bigint;
}

/**
 * Pure step planner for Tap creation and initial funding flow.
 *
 * For native BOT: create() is payable, so funding happens in a single transaction.
 * For ERC-20 tokens:
 * - If unfunded (initialFund == 0): create() only.
 * - If funded and allowance covers amount: create() -> fundToken().
 * - If funded and allowance is insufficient: approve() -> create() -> fundToken().
 */
export function planTapFundingSteps(params: PlanParams): TapFundingStep[] {
  const { assetType, initialFund, allowance = 0n } = params;

  if (assetType === "native") {
    return ["create"];
  }

  if (initialFund === 0n) {
    return ["create"];
  }

  if (allowance >= initialFund) {
    return ["create", "fundToken"];
  }

  return ["approve", "create", "fundToken"];
}

export interface PendingFunding {
  tapId: string;
  tokenAddress: string;
  tokenSymbol: string;
  tokenDecimals: number;
  amountStr: string;
  step: "create" | "fundToken";
}

const STORAGE_KEY = "tap_pending_funding";

export function savePendingFunding(data: PendingFunding): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Ignore storage quota or disabled storage
  }
}

export function getPendingFunding(tapId?: string): PendingFunding | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingFunding;
    if (tapId && parsed.tapId !== tapId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearPendingFunding(tapId?: string): void {
  if (typeof window === "undefined") return;
  try {
    if (tapId) {
      const current = getPendingFunding();
      if (current?.tapId === tapId) {
        localStorage.removeItem(STORAGE_KEY);
      }
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Ignore storage issues
  }
}

import { BaseError, ContractFunctionRevertedError } from "viem";
import { ONCE } from "./limits";

export interface RevertDetails {
  errorName?: string;
  args?: readonly unknown[];
}

export function shortAddress(addr: string): string {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/**
 * Traverses an error to extract the custom revert error name and arguments.
 */
export function extractRevert(err: unknown): RevertDetails | undefined {
  if (typeof err !== "object" || err === null) return undefined;

  // Direct property check
  if (
    "data" in err &&
    (err as any).data &&
    typeof (err as any).data === "object" &&
    (err as any).data.errorName
  ) {
    return {
      errorName: (err as any).data.errorName,
      args: (err as any).data.args,
    };
  }
  if ("errorName" in err && typeof (err as any).errorName === "string") {
    return {
      errorName: (err as any).errorName,
      args: (err as any).args,
    };
  }

  // If it's a viem BaseError, use walk
  if (err instanceof BaseError) {
    const reverted = err.walk((e) => {
      if (e instanceof ContractFunctionRevertedError) return true;
      if (
        typeof e === "object" &&
        e !== null &&
        "data" in e &&
        Boolean((e as any).data?.errorName)
      )
        return true;
      if (
        typeof e === "object" &&
        e !== null &&
        "errorName" in e &&
        Boolean((e as any).errorName)
      )
        return true;
      return false;
    });

    if (reverted) {
      const errorObj = reverted as any;
      if (errorObj.data?.errorName) {
        return {
          errorName: errorObj.data.errorName,
          args: errorObj.data.args,
        };
      }
      if (errorObj.errorName) {
        return {
          errorName: errorObj.errorName,
          args: errorObj.args,
        };
      }
    }
  }

  return undefined;
}

/**
 * Checks whether an error represents the user rejecting the prompt in their wallet.
 */
export function isUserRejection(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("User rejected") ||
    msg.includes("User denied") ||
    msg.includes("user rejected") ||
    msg.includes("ACTION_REJECTED") ||
    (typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: number }).code === 4001)
  );
}

/**
 * Translates an error into user-facing copy for Tap.
 */
export function describeError(err: unknown): string {
  if (isUserRejection(err)) {
    return "Transaction cancelled in wallet.";
  }

  const rev = extractRevert(err);
  if (rev?.errorName) {
    switch (rev.errorName) {
      case "OnCooldown": {
        const nextAt = rev.args?.[1];
        if (nextAt !== undefined && BigInt(nextAt as string | number | bigint) === ONCE) {
          return "This tap allows only one draw per wallet, and this wallet has already drawn.";
        }
        if (nextAt !== undefined) {
          const date = new Date(Number(nextAt) * 1000);
          return `Wallet is on cooldown until ${date.toLocaleTimeString()}.`;
        }
        return "Wallet is currently on cooldown for this tap.";
      }
      case "Empty": {
        return "This tap is empty. Waiting for the creator or community to top it up.";
      }
      case "UnsupportedToken":
        return "This token is not supported (fee-on-transfer or rebasing tokens cannot be used).";
      case "NotAContract":
        return "The provided token address has no contract bytecode.";
      case "NotOwner":
        return "Only the tap creator can withdraw from this tap.";
      case "InsufficientBalance":
        return "Withdrawal amount exceeds the current tap balance.";
      case "BadCooldown":
        return "Cooldown must be between 60 seconds and 365 days, or ONCE.";
      case "WrongAsset":
        return "Asset mismatch: cannot fund this tap with the specified currency.";
      case "ZeroAmount":
        return "Amount must be greater than zero.";
      case "UnexpectedValue":
        return "Native BOT cannot be sent when creating or funding an ERC-20 tap.";
      case "NameTooLong": {
        const max = rev.args?.[1] ?? 40;
        return `Tap name is too long (maximum ${max} bytes).`;
      }
      case "NoSuchTap":
        return "Tap does not exist.";
      case "TransferFailed":
        return "Token or native transfer failed.";
    }
  }

  if (err instanceof Error) {
    const m = err.message;
    if (m.includes("OnCooldown")) {
      return "Wallet is currently on cooldown for this tap.";
    }
    if (m.includes("Empty")) {
      return "This tap is empty. Waiting for the creator or community to top it up.";
    }
    if (m.includes("UnsupportedToken")) {
      return "This token is not supported (fee-on-transfer or rebasing tokens cannot be used).";
    }
    if (m.includes("connector not connected")) {
      return "Please connect your wallet.";
    }
    return m.length < 120 ? m : `${m.slice(0, 117)}…`;
  }

  return "An unexpected error occurred. Please try again.";
}

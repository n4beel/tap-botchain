import { describe, expect, it } from "vitest";
import { describeError, isUserRejection, shortAddress } from "../errors";
import { ONCE } from "../limits";

describe("errors helper", () => {
  describe("shortAddress", () => {
    it("shortens normal 42-char addresses", () => {
      expect(shortAddress("0x1234567890123456789012345678901234567890")).toBe("0x1234…7890");
    });

    it("returns short string as is", () => {
      expect(shortAddress("0x123")).toBe("0x123");
      expect(shortAddress("")).toBe("");
    });
  });

  describe("isUserRejection", () => {
    it("detects user rejection messages", () => {
      expect(isUserRejection(new Error("User rejected the request."))).toBe(true);
      expect(isUserRejection(new Error("User denied transaction signature."))).toBe(true);
      expect(isUserRejection({ code: 4001, message: "Rejected" })).toBe(true);
      expect(isUserRejection(new Error("Network timeout"))).toBe(false);
      expect(isUserRejection(null)).toBe(false);
    });
  });

  describe("describeError", () => {
    it("handles user rejections", () => {
      expect(describeError(new Error("User rejected the transaction."))).toBe(
        "Transaction cancelled in wallet."
      );
    });

    it("handles OnCooldown with ONCE", () => {
      const err = {
        data: {
          errorName: "OnCooldown",
          args: [1n, ONCE],
        },
      };
      expect(describeError(err)).toBe(
        "This tap allows only one draw per wallet, and this wallet has already drawn."
      );
    });

    it("handles OnCooldown with timestamp", () => {
      const timestamp = 1700000000n;
      const err = {
        data: {
          errorName: "OnCooldown",
          args: [1n, timestamp],
        },
      };
      expect(describeError(err)).toContain("Wallet is on cooldown until");
    });

    it("handles OnCooldown without args", () => {
      const err = { data: { errorName: "OnCooldown" } };
      expect(describeError(err)).toBe("Wallet is currently on cooldown for this tap.");
    });

    it("handles Empty custom error", () => {
      const err = { data: { errorName: "Empty" } };
      expect(describeError(err)).toBe(
        "This tap is empty. Waiting for the creator or community to top it up."
      );
    });

    it("handles UnsupportedToken custom error", () => {
      const err = { data: { errorName: "UnsupportedToken" } };
      expect(describeError(err)).toBe(
        "This token is not supported (fee-on-transfer or rebasing tokens cannot be used)."
      );
    });

    it("handles NotAContract custom error", () => {
      const err = { data: { errorName: "NotAContract" } };
      expect(describeError(err)).toBe("The provided token address has no contract bytecode.");
    });

    it("handles NotOwner custom error", () => {
      const err = { data: { errorName: "NotOwner" } };
      expect(describeError(err)).toBe("Only the tap creator can withdraw from this tap.");
    });

    it("handles InsufficientBalance custom error", () => {
      const err = { data: { errorName: "InsufficientBalance" } };
      expect(describeError(err)).toBe("Withdrawal amount exceeds the current tap balance.");
    });

    it("handles BadCooldown custom error", () => {
      const err = { data: { errorName: "BadCooldown" } };
      expect(describeError(err)).toBe(
        "Cooldown must be between 60 seconds and 365 days, or ONCE."
      );
    });

    it("handles WrongAsset custom error", () => {
      const err = { data: { errorName: "WrongAsset" } };
      expect(describeError(err)).toBe(
        "Asset mismatch: cannot fund this tap with the specified currency."
      );
    });

    it("handles ZeroAmount custom error", () => {
      const err = { data: { errorName: "ZeroAmount" } };
      expect(describeError(err)).toBe("Amount must be greater than zero.");
    });

    it("handles UnexpectedValue custom error", () => {
      const err = { data: { errorName: "UnexpectedValue" } };
      expect(describeError(err)).toBe(
        "Native BOT cannot be sent when creating or funding an ERC-20 tap."
      );
    });

    it("handles NameTooLong custom error", () => {
      const err = { data: { errorName: "NameTooLong", args: [50, 40] } };
      expect(describeError(err)).toBe("Tap name is too long (maximum 40 bytes).");
    });

    it("handles NoSuchTap custom error", () => {
      const err = { data: { errorName: "NoSuchTap" } };
      expect(describeError(err)).toBe("Tap does not exist.");
    });

    it("handles TransferFailed custom error", () => {
      const err = { data: { errorName: "TransferFailed" } };
      expect(describeError(err)).toBe("Token or native transfer failed.");
    });

    it("handles message substrings in general errors", () => {
      expect(describeError(new Error("connector not connected"))).toBe(
        "Please connect your wallet."
      );
      expect(describeError(new Error("reverted: OnCooldown"))).toBe(
        "Wallet is currently on cooldown for this tap."
      );
      expect(describeError(new Error("reverted: Empty"))).toBe(
        "This tap is empty. Waiting for the creator or community to top it up."
      );
      expect(describeError(new Error("reverted: UnsupportedToken"))).toBe(
        "This token is not supported (fee-on-transfer or rebasing tokens cannot be used)."
      );
    });

    it("truncates very long unknown errors", () => {
      const longMsg = "A".repeat(150);
      const res = describeError(new Error(longMsg));
      expect(res.length).toBeLessThan(125);
      expect(res.endsWith("…")).toBe(true);
    });

    it("falls back to generic message on non-error", () => {
      expect(describeError(null)).toBe("An unexpected error occurred. Please try again.");
    });
  });
});

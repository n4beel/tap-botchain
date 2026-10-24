import { describe, expect, it, vi } from "vitest";
import { zeroAddress } from "viem";
import { ONCE } from "../limits";
import {
  byteLength,
  describeCooldown,
  drawsLeft,
  formatDraw,
  levelFraction,
  loadTapName,
  phase,
  tokenMeta,
  type TapView,
} from "../tap";

describe("tap utilities", () => {
  describe("byteLength", () => {
    it("measures ASCII strings", () => {
      expect(byteLength("hello")).toBe(5);
    });

    it("measures multi-byte unicode strings", () => {
      expect(byteLength("💧")).toBe(4);
      expect(byteLength("Tap 💧")).toBe(8);
    });
  });

  describe("describeCooldown", () => {
    it("handles ONCE", () => {
      expect(describeCooldown(ONCE)).toBe("Once ever");
    });

    it("handles seconds", () => {
      expect(describeCooldown(30n)).toBe("30s");
    });

    it("handles minutes", () => {
      expect(describeCooldown(60n)).toBe("1 min");
      expect(describeCooldown(90n)).toBe("1.5 min");
      expect(describeCooldown(1800n)).toBe("30 min");
    });

    it("handles hours", () => {
      expect(describeCooldown(3600n)).toBe("1 hr");
      expect(describeCooldown(7200n)).toBe("2 hr");
      expect(describeCooldown(5400n)).toBe("1.5 hr");
    });

    it("handles days", () => {
      expect(describeCooldown(86400n)).toBe("1 day");
      expect(describeCooldown(172800n)).toBe("2 days");
    });

    it("handles weeks", () => {
      expect(describeCooldown(604800n)).toBe("1 week");
      expect(describeCooldown(1209600n)).toBe("2 weeks");
    });
  });

  describe("formatDraw", () => {
    it("formats 18-decimal BOT amounts", () => {
      expect(formatDraw(10_000_000_000_000_000n, 18, "BOT")).toBe("0.01 BOT");
      expect(formatDraw(1_000_000_000_000_000_000n, 18, "BOT")).toBe("1 BOT");
    });

    it("formats 6-decimal token amounts", () => {
      expect(formatDraw(100_000_000n, 6, "USDC")).toBe("100 USDC");
      expect(formatDraw(500_000n, 6, "USDC")).toBe("0.5 USDC");
    });
  });

  describe("drawsLeft", () => {
    it("computes draws cleanly", () => {
      expect(drawsLeft(100n, 10n)).toBe(10n);
      expect(drawsLeft(95n, 10n)).toBe(9n);
      expect(drawsLeft(0n, 10n)).toBe(0n);
      expect(drawsLeft(100n, 0n)).toBe(0n);
    });
  });

  describe("levelFraction", () => {
    it("returns 1 if nextAt is 0", () => {
      expect(levelFraction(0n, 3600n)).toBe(1);
    });

    it("returns 0 if nextAt is ONCE", () => {
      expect(levelFraction(ONCE, ONCE)).toBe(0);
    });

    it("returns 0 if cooldown is 0 or ONCE", () => {
      expect(levelFraction(100n, 0n)).toBe(0);
      expect(levelFraction(100n, ONCE)).toBe(0);
    });

    it("returns 1 if current time has passed nextAt", () => {
      expect(levelFraction(1000n, 3600n, 1050)).toBe(1);
    });

    it("calculates progress fraction correctly", () => {
      // Cooldown 100s. nextAt = 1000. current = 950.
      // remaining = 50s. elapsed = 50s. fraction = 0.5
      expect(levelFraction(1000n, 100n, 950)).toBe(0.5);

      // remaining = 20s. elapsed = 80s. fraction = 0.8
      expect(levelFraction(1000n, 100n, 980)).toBe(0.8);
    });
  });

  describe("phase", () => {
    const baseTap: TapView = {
      id: 1n,
      owner: "0x1111111111111111111111111111111111111111",
      token: zeroAddress,
      perDraw: 10n,
      balance: 100n,
      cooldown: 3600n,
      draws: 0,
      createdBlock: 1n,
    };

    it("returns empty if balance < perDraw", () => {
      expect(phase({ ...baseTap, balance: 5n }, 0n)).toBe("empty");
    });

    it("returns used if nextAt is ONCE", () => {
      expect(phase(baseTap, ONCE)).toBe("used");
    });

    it("returns cooldown if nextAt is in the future", () => {
      expect(phase(baseTap, 1000n, 900)).toBe("cooldown");
    });

    it("returns canDraw if nextAt is in the past", () => {
      expect(phase(baseTap, 1000n, 1001)).toBe("canDraw");
      expect(phase(baseTap, 0n, 1001)).toBe("canDraw");
    });
  });

  describe("tokenMeta", () => {
    it("returns native BOT metadata for zero address", async () => {
      const meta = await tokenMeta({} as any, zeroAddress);
      expect(meta).toEqual({
        symbol: "BOT",
        decimals: 18,
        name: "BOT Chain Native",
      });
    });

    it("fetches token metadata for ERC-20 contract", async () => {
      const client = {
        readContract: vi.fn().mockImplementation(({ functionName }) => {
          if (functionName === "symbol") return Promise.resolve("TST");
          if (functionName === "decimals") return Promise.resolve(18);
          if (functionName === "name") return Promise.resolve("Test Token");
          return Promise.reject(new Error("Unknown function"));
        }),
      } as any;

      const meta = await tokenMeta(client, "0x2222222222222222222222222222222222222222");
      expect(meta).toEqual({
        symbol: "TST",
        decimals: 18,
        name: "Test Token",
      });
    });

    it("falls back gracefully on read errors", async () => {
      const client = {
        readContract: vi.fn().mockRejectedValue(new Error("Call reverted")),
      } as any;

      const meta = await tokenMeta(client, "0x2222222222222222222222222222222222222222");
      expect(meta.symbol).toBe("TOKEN");
      expect(meta.decimals).toBe(18);
    });
  });

  describe("loadTapName", () => {
    it("reads name from single-block logs and caches result", async () => {
      const client = {
        getLogs: vi.fn().mockResolvedValue([
          {
            args: { id: 1n, name: "Community Faucet" },
          },
        ]),
      } as any;

      const name = await loadTapName(
        client,
        "0x3333333333333333333333333333333333333333",
        1n,
        100n
      );
      expect(name).toBe("Community Faucet");
      expect(client.getLogs).toHaveBeenCalledWith(
        expect.objectContaining({
          fromBlock: 100n,
          toBlock: 100n,
        })
      );

      // Verify second call uses cache and doesn't call getLogs again
      client.getLogs.mockClear();
      const cached = await loadTapName(
        client,
        "0x3333333333333333333333333333333333333333",
        1n,
        100n
      );
      expect(cached).toBe("Community Faucet");
      expect(client.getLogs).not.toHaveBeenCalled();
    });

    it("falls back if logs are empty or fail", async () => {
      const client = {
        getLogs: vi.fn().mockRejectedValue(new Error("RPC failure")),
      } as any;

      const fallback = await loadTapName(
        client,
        "0x4444444444444444444444444444444444444444",
        99n,
        200n
      );
      expect(fallback).toBe("Tap #99");
    });
  });
});

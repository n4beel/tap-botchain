import { describe, expect, it } from "vitest";
import { planTapFundingSteps } from "../tap-funding";

describe("planTapFundingSteps", () => {
  describe("native BOT", () => {
    it("plans single create step when unfunded (initialFund = 0)", () => {
      const steps = planTapFundingSteps({
        assetType: "native",
        initialFund: 0n,
      });
      expect(steps).toEqual(["create"]);
    });

    it("plans single create step when funded with msg.value", () => {
      const steps = planTapFundingSteps({
        assetType: "native",
        initialFund: 1000000000000000000n, // 1 BOT
      });
      expect(steps).toEqual(["create"]);
    });
  });

  describe("ERC-20 token", () => {
    it("plans single create step when unfunded", () => {
      const steps = planTapFundingSteps({
        assetType: "token",
        initialFund: 0n,
        allowance: 0n,
      });
      expect(steps).toEqual(["create"]);
    });

    it("plans approve -> create -> fundToken when allowance is zero", () => {
      const steps = planTapFundingSteps({
        assetType: "token",
        initialFund: 500n * 10n ** 18n,
        allowance: 0n,
      });
      expect(steps).toEqual(["approve", "create", "fundToken"]);
    });

    it("plans approve -> create -> fundToken when allowance is insufficient", () => {
      const steps = planTapFundingSteps({
        assetType: "token",
        initialFund: 500n * 10n ** 18n,
        allowance: 200n * 10n ** 18n,
      });
      expect(steps).toEqual(["approve", "create", "fundToken"]);
    });

    it("plans create -> fundToken when allowance already covers funding amount", () => {
      const steps = planTapFundingSteps({
        assetType: "token",
        initialFund: 500n * 10n ** 18n,
        allowance: 500n * 10n ** 18n,
      });
      expect(steps).toEqual(["create", "fundToken"]);
    });

    it("plans create -> fundToken when allowance exceeds funding amount", () => {
      const steps = planTapFundingSteps({
        assetType: "token",
        initialFund: 500n * 10n ** 18n,
        allowance: 1000n * 10n ** 18n,
      });
      expect(steps).toEqual(["create", "fundToken"]);
    });
  });
});

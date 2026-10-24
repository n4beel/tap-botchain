import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  BaseError,
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseEther,
  parseUnits,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { tapAbi } from "@/lib/botchain/abi";
import { erc20Abi } from "@/lib/erc20";
import {
  describeCooldown,
  drawsLeft,
  formatDraw,
  levelFraction,
  loadTapName,
  phase,
  tokenMeta,
} from "@/lib/tap";
import { MAX_COOLDOWN, MAX_NAME_BYTES, MAX_PAGE, MIN_COOLDOWN, ONCE } from "@/lib/limits";

const PORT = 8606;
const RPC = `http://127.0.0.1:${PORT}`;
const CHAIN_ID = 968 as const;

const MNEMONIC = "test test test test test test test test test test test junk";
const accounts = Array.from({ length: 8 }, (_, i) =>
  mnemonicToAccount(MNEMONIC, { addressIndex: i })
);

const local = defineChain({
  id: CHAIN_ID,
  name: "anvil",
  nativeCurrency: { name: "Test BOT", symbol: "tBOT", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

let node: ChildProcess;
let publicClient: PublicClient;
let wallets: WalletClient[];
let tapAddress: Address;
let tokenAddress: Address;

function revertDetails(err: unknown): { errorName?: string; args?: readonly unknown[] } | undefined {
  if (!(err instanceof BaseError)) return undefined;
  const found = err.walk(
    (e) =>
      typeof e === "object" &&
      e !== null &&
      "data" in e &&
      Boolean((e as { data?: { errorName?: string } }).data?.errorName)
  ) as { data?: { errorName?: string; args?: readonly unknown[] } } | null;
  return found?.data;
}

beforeAll(async () => {
  node = spawn("anvil", ["--port", String(PORT), "--chain-id", String(CHAIN_ID), "--silent"], {
    stdio: ["ignore", "ignore", "inherit"],
  });

  publicClient = createPublicClient({ chain: local, transport: http() }) as PublicClient;
  wallets = accounts.map((acc) =>
    createWalletClient({ account: acc, chain: local, transport: http() })
  );

  for (let i = 0; ; i++) {
    try {
      await publicClient.getBlockNumber();
      break;
    } catch {
      if (i > 100) throw new Error(`anvil never answered on ${RPC}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  // 1. Deploy Tap contract
  const tapArtifact = JSON.parse(
    readFileSync("contracts/out/Tap.sol/Tap.json", "utf8")
  ) as { abi: any; bytecode: { object: Hex } };

  const tapHash = await wallets[0].deployContract({
    abi: tapArtifact.abi,
    bytecode: tapArtifact.bytecode.object,
    args: [],
    chain: local,
    account: accounts[0],
  });
  const tapReceipt = await publicClient.waitForTransactionReceipt({ hash: tapHash });
  tapAddress = tapReceipt.contractAddress!;

  // 2. Deploy MockERC20
  const tokenArtifact = JSON.parse(
    readFileSync("contracts/out/MockERC20.sol/MockERC20.json", "utf8")
  ) as { abi: any; bytecode: { object: Hex } };

  const tokenHash = await wallets[0].deployContract({
    abi: tokenArtifact.abi,
    bytecode: tokenArtifact.bytecode.object,
    args: ["Test Token", "TST", 18],
    chain: local,
    account: accounts[0],
  });
  const tokenReceipt = await publicClient.waitForTransactionReceipt({ hash: tokenHash });
  tokenAddress = tokenReceipt.contractAddress!;

  // Mint tokens to accounts 0-3
  for (let i = 0; i < 4; i++) {
    const mintHash = await wallets[0].writeContract({
      address: tokenAddress,
      abi: [
        {
          type: "function",
          name: "mint",
          inputs: [
            { name: "to", type: "address" },
            { name: "amount", type: "uint256" },
          ],
          outputs: [],
          stateMutability: "nonpayable",
        },
      ],
      functionName: "mint",
      args: [accounts[i].address, parseUnits("100000", 18)],
      chain: local,
      account: accounts[0],
    });
    await publicClient.waitForTransactionReceipt({ hash: mintHash });
  }
});

afterAll(async () => {
  if (node) {
    node.kill("SIGTERM");
  }
});

describe("Tap integration suite", () => {
  it("deploys Tap and MockERC20 cleanly", async () => {
    expect(tapAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(tokenAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);

    const code = await publicClient.getBytecode({ address: tapAddress });
    expect(code).toBeDefined();
    expect(code!.length).toBeGreaterThan(2);
  });

  it("checks public protocol constants match limits", async () => {
    const [minCd, maxCd, onceVal, maxName, maxPg] = await Promise.all([
      publicClient.readContract({ address: tapAddress, abi: tapAbi, functionName: "MIN_COOLDOWN" }),
      publicClient.readContract({ address: tapAddress, abi: tapAbi, functionName: "MAX_COOLDOWN" }),
      publicClient.readContract({ address: tapAddress, abi: tapAbi, functionName: "ONCE" }),
      publicClient.readContract({ address: tapAddress, abi: tapAbi, functionName: "MAX_NAME_BYTES" }),
      publicClient.readContract({ address: tapAddress, abi: tapAbi, functionName: "MAX_PAGE" }),
    ]);

    expect(minCd).toBe(MIN_COOLDOWN);
    expect(maxCd).toBe(MAX_COOLDOWN);
    expect(onceVal).toBe(ONCE);
    expect(maxName).toBe(BigInt(MAX_NAME_BYTES));
    expect(maxPg).toBe(BigInt(MAX_PAGE));
  });

  it("creates a native BOT tap with initial funding", async () => {
    const perDraw = parseEther("0.01");
    const initialDeposit = parseEther("0.2");
    const cooldown = 3600n; // 1 hour

    const hash = await wallets[0].writeContract({
      address: tapAddress,
      abi: tapAbi,
      functionName: "create",
      args: [zeroAddress, perDraw, cooldown, "Community BOT Faucet"],
      value: initialDeposit,
      chain: local,
      account: accounts[0],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    expect(receipt.status).toBe("success");

    const total = await publicClient.readContract({
      address: tapAddress,
      abi: tapAbi,
      functionName: "tapCount",
    });
    expect(total).toBe(1n);

    const tap = await publicClient.readContract({
      address: tapAddress,
      abi: tapAbi,
      functionName: "tapOf",
      args: [1n],
    });

    expect(tap.id).toBe(1n);
    expect(tap.owner.toLowerCase()).toBe(accounts[0].address.toLowerCase());
    expect(tap.token).toBe(zeroAddress);
    expect(tap.perDraw).toBe(perDraw);
    expect(tap.balance).toBe(initialDeposit);
    expect(tap.cooldown).toBe(cooldown);
    expect(tap.draws).toBe(0);

    // Verify name loader from logs
    const name = await loadTapName(publicClient, tapAddress, 1n, tap.createdBlock);
    expect(name).toBe("Community BOT Faucet");
  });

  it("draws from native tap and enforces cooldown with exact nextAt arg", async () => {
    const drawer = accounts[1];
    const balBefore = await publicClient.getBalance({ address: drawer.address });

    // Initial eligible draw
    const hash = await wallets[1].writeContract({
      address: tapAddress,
      abi: tapAbi,
      functionName: "draw",
      args: [1n],
      chain: local,
      account: drawer,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    expect(receipt.status).toBe("success");

    const gasUsed = receipt.gasUsed * receipt.effectiveGasPrice;
    const balAfter = await publicClient.getBalance({ address: drawer.address });
    expect(balAfter + gasUsed - balBefore).toBe(parseEther("0.01"));

    // Verify nextDrawAt
    const nextAt = await publicClient.readContract({
      address: tapAddress,
      abi: tapAbi,
      functionName: "nextDrawAt",
      args: [1n, drawer.address],
    });
    expect(nextAt).toBeGreaterThan(0n);

    // Immediate second draw must revert OnCooldown
    let reverted = false;
    try {
      await publicClient.simulateContract({
        address: tapAddress,
        abi: tapAbi,
        functionName: "draw",
        args: [1n],
        account: drawer.address,
      });
    } catch (err) {
      reverted = true;
      const rev = revertDetails(err);
      expect(rev?.errorName).toBe("OnCooldown");
      expect(rev?.args?.[0]).toBe(1n);
      expect(rev?.args?.[1]).toBe(nextAt);
    }
    expect(reverted).toBe(true);
  });

  it("allows draw again after cooldown has elapsed", async () => {
    const drawer = accounts[1];

    // Warp forward 3601 seconds
    await publicClient.request({
      method: "evm_increaseTime" as any,
      params: [3601],
    });
    await publicClient.request({
      method: "evm_mine" as any,
      params: [],
    });

    const nextAt = await publicClient.readContract({
      address: tapAddress,
      abi: tapAbi,
      functionName: "nextDrawAt",
      args: [1n, drawer.address],
    });
    expect(nextAt).toBe(0n);

    const hash = await wallets[1].writeContract({
      address: tapAddress,
      abi: tapAbi,
      functionName: "draw",
      args: [1n],
      chain: local,
      account: drawer,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    expect(receipt.status).toBe("success");

    const tap = await publicClient.readContract({
      address: tapAddress,
      abi: tapAbi,
      functionName: "tapOf",
      args: [1n],
    });
    expect(tap.draws).toBe(2);
  });

  it("tops up native tap with fundNative", async () => {
    const fundAmount = parseEther("0.5");
    const hash = await wallets[2].writeContract({
      address: tapAddress,
      abi: tapAbi,
      functionName: "fundNative",
      args: [1n],
      value: fundAmount,
      chain: local,
      account: accounts[2],
    });
    await publicClient.waitForTransactionReceipt({ hash });

    const tap = await publicClient.readContract({
      address: tapAddress,
      abi: tapAbi,
      functionName: "tapOf",
      args: [1n],
    });
    expect(tap.balance).toBe(parseEther("0.2") - parseEther("0.02") + fundAmount);
  });

  it("creates token tap and funds it via approve + fundToken", async () => {
    const perDraw = parseUnits("100", 18);
    const fundAmount = parseUnits("5000", 18);

    // 1. Create token tap
    const createHash = await wallets[0].writeContract({
      address: tapAddress,
      abi: tapAbi,
      functionName: "create",
      args: [tokenAddress, perDraw, ONCE, "Test Token Single Faucet"],
      chain: local,
      account: accounts[0],
    });
    await publicClient.waitForTransactionReceipt({ hash: createHash });

    const tap = await publicClient.readContract({
      address: tapAddress,
      abi: tapAbi,
      functionName: "tapOf",
      args: [2n],
    });
    expect(tap.id).toBe(2n);
    expect(tap.token.toLowerCase()).toBe(tokenAddress.toLowerCase());
    expect(tap.balance).toBe(0n);
    expect(tap.cooldown).toBe(ONCE);

    // 2. Approve
    const approveHash = await wallets[0].writeContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: "approve",
      args: [tapAddress, fundAmount],
      chain: local,
      account: accounts[0],
    });
    await publicClient.waitForTransactionReceipt({ hash: approveHash });

    // 3. Fund token tap
    const fundHash = await wallets[0].writeContract({
      address: tapAddress,
      abi: tapAbi,
      functionName: "fundToken",
      args: [2n, fundAmount],
      chain: local,
      account: accounts[0],
    });
    await publicClient.waitForTransactionReceipt({ hash: fundHash });

    const fundedTap = await publicClient.readContract({
      address: tapAddress,
      abi: tapAbi,
      functionName: "tapOf",
      args: [2n],
    });
    expect(fundedTap.balance).toBe(fundAmount);
  });

  it("draws from ONCE token tap and permanently bars second draw", async () => {
    const drawer = accounts[2];

    const tokenBalBefore = (await publicClient.readContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [drawer.address],
    })) as bigint;

    const hash = await wallets[2].writeContract({
      address: tapAddress,
      abi: tapAbi,
      functionName: "draw",
      args: [2n],
      chain: local,
      account: drawer,
    });
    await publicClient.waitForTransactionReceipt({ hash });

    const tokenBalAfter = (await publicClient.readContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [drawer.address],
    })) as bigint;

    expect(tokenBalAfter - tokenBalBefore).toBe(parseUnits("100", 18));

    const nextAt = await publicClient.readContract({
      address: tapAddress,
      abi: tapAbi,
      functionName: "nextDrawAt",
      args: [2n, drawer.address],
    });
    expect(nextAt).toBe(ONCE);

    // Second draw must revert with OnCooldown(2, ONCE)
    let reverted = false;
    try {
      await publicClient.simulateContract({
        address: tapAddress,
        abi: tapAbi,
        functionName: "draw",
        args: [2n],
        account: drawer.address,
      });
    } catch (err) {
      reverted = true;
      const rev = revertDetails(err);
      expect(rev?.errorName).toBe("OnCooldown");
      expect(rev?.args?.[0]).toBe(2n);
      expect(rev?.args?.[1]).toBe(ONCE);
    }
    expect(reverted).toBe(true);
  });

  it("owner withdraws from tap; non-owner withdraw reverts", async () => {
    const withdrawAmount = parseEther("0.1");

    // Non-owner withdraw reverts NotOwner
    let nonOwnerReverted = false;
    try {
      await publicClient.simulateContract({
        address: tapAddress,
        abi: tapAbi,
        functionName: "withdraw",
        args: [1n, withdrawAmount],
        account: accounts[3].address,
      });
    } catch (err) {
      nonOwnerReverted = true;
      const rev = revertDetails(err);
      expect(rev?.errorName).toBe("NotOwner");
    }
    expect(nonOwnerReverted).toBe(true);

    // Owner withdraw succeeds
    const ownerBalBefore = await publicClient.getBalance({ address: accounts[0].address });
    const hash = await wallets[0].writeContract({
      address: tapAddress,
      abi: tapAbi,
      functionName: "withdraw",
      args: [1n, withdrawAmount],
      chain: local,
      account: accounts[0],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    expect(receipt.status).toBe("success");

    const gasUsed = receipt.gasUsed * receipt.effectiveGasPrice;
    const ownerBalAfter = await publicClient.getBalance({ address: accounts[0].address });
    expect(ownerBalAfter + gasUsed - ownerBalBefore).toBe(withdrawAmount);
  });

  it("reverts Empty when tap balance is less than perDraw", async () => {
    // Create an empty native tap (0 value)
    const hash = await wallets[0].writeContract({
      address: tapAddress,
      abi: tapAbi,
      functionName: "create",
      args: [zeroAddress, parseEther("1"), 3600n, "Empty Native Tap"],
      chain: local,
      account: accounts[0],
    });
    await publicClient.waitForTransactionReceipt({ hash });

    let emptyReverted = false;
    try {
      await publicClient.simulateContract({
        address: tapAddress,
        abi: tapAbi,
        functionName: "draw",
        args: [3n],
        account: accounts[1].address,
      });
    } catch (err) {
      emptyReverted = true;
      const rev = revertDetails(err);
      expect(rev?.errorName).toBe("Empty");
      expect(rev?.args?.[0]).toBe(3n);
      expect(rev?.args?.[1]).toBe(0n);
      expect(rev?.args?.[2]).toBe(parseEther("1"));
    }
    expect(emptyReverted).toBe(true);
  });

  it("retrieves latest taps with pagination and tapsBy", async () => {
    const list = await publicClient.readContract({
      address: tapAddress,
      abi: tapAbi,
      functionName: "latest",
      args: [0n, 10n],
    });
    expect(list.length).toBe(3);
    // Newest first: tap 3, tap 2, tap 1
    expect(list[0].id).toBe(3n);
    expect(list[1].id).toBe(2n);
    expect(list[2].id).toBe(1n);

    const ownerTaps = await publicClient.readContract({
      address: tapAddress,
      abi: tapAbi,
      functionName: "tapsBy",
      args: [accounts[0].address],
    });
    expect(ownerTaps.length).toBe(3);
    expect(ownerTaps.map((id) => Number(id))).toEqual([1, 2, 3]);
  });

  it("verifies helpers with live contract data", async () => {
    const meta = await tokenMeta(publicClient, tokenAddress);
    expect(meta.symbol).toBe("TST");
    expect(meta.decimals).toBe(18);

    const nativeTap = await publicClient.readContract({
      address: tapAddress,
      abi: tapAbi,
      functionName: "tapOf",
      args: [1n],
    });

    const drawStr = formatDraw(nativeTap.perDraw, 18, "BOT");
    expect(drawStr).toBe("0.01 BOT");

    const cdStr = describeCooldown(nativeTap.cooldown);
    expect(cdStr).toBe("1 hr");

    const remaining = drawsLeft(nativeTap.balance, nativeTap.perDraw);
    expect(remaining).toBeGreaterThan(0n);

    const p = phase(nativeTap, 0n);
    expect(p).toBe("canDraw");

    const emptyTap = await publicClient.readContract({
      address: tapAddress,
      abi: tapAbi,
      functionName: "tapOf",
      args: [3n],
    });
    expect(phase(emptyTap, 0n)).toBe("empty");

    const frac = levelFraction(0n, 3600n);
    expect(frac).toBe(1);
  });
});

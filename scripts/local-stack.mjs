/**
 * Local stack runner and seeder for Tap.
 *
 * Spawns anvil on port 8706 with chain id 968, deploys Tap and MockERC20, and seeds
 * the scenarios from 06-tap.md §5:
 * (1) native 0.01 BOT/draw, 1-day cooldown, balance 0.2, 4 draws made
 * (2) TST 100/draw, ONCE, balance 5,000
 * (3) native, empty
 * (4) TST, 1-hour cooldown, account 0 drew 20 minutes ago (cooldown running)
 * (5) owned by account 0 with draws by others
 *
 * Usage:
 *   node scripts/local-stack.mjs
 */

import { spawn, execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseEther,
  parseUnits,
  zeroAddress,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";

const PORT = 8706;
const RPC = `http://127.0.0.1:${PORT}`;
const CHAIN_ID = 968;

const MNEMONIC = "test test test test test test test test test test test junk";

const local = defineChain({
  id: CHAIN_ID,
  name: "anvil",
  nativeCurrency: { name: "Test BOT", symbol: "tBOT", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

try {
  execSync(`fuser -k ${PORT}/tcp 2>/dev/null || true`);
} catch {}

const TOTAL_WARP = 1200; // 20 minutes in seconds (Scenario 4 drew 20m ago)
const realNow = Math.floor(Date.now() / 1000);
const startTimestamp = realNow - TOTAL_WARP;

console.log(`Starting anvil on port ${PORT} with start timestamp ${startTimestamp}...`);
spawn("anvil", [
  "--port", String(PORT),
  "--chain-id", String(CHAIN_ID),
  "--accounts", "10",
  "--timestamp", String(startTimestamp),
  "--block-time", "1",
  "--silent",
], {
  detached: true,
  stdio: "ignore",
}).unref();

const pub = createPublicClient({ chain: local, transport: http() });

const accounts = Array.from({ length: 10 }, (_, i) =>
  mnemonicToAccount(MNEMONIC, { addressIndex: i })
);
const wallets = accounts.map((acc) =>
  createWalletClient({ account: acc, chain: local, transport: http() })
);

// Wait for anvil to answer
for (let i = 0; ; i++) {
  try {
    await pub.getBlockNumber();
    break;
  } catch {
    if (i > 100) throw new Error(`anvil never answered on ${RPC}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

const tapArtifact = JSON.parse(
  readFileSync("contracts/out/Tap.sol/Tap.json", "utf8")
);
const tapAbi = tapArtifact.abi;

const tokenArtifact = JSON.parse(
  readFileSync("contracts/out/MockERC20.sol/MockERC20.json", "utf8")
);
const tokenAbi = tokenArtifact.abi;

console.log("Deploying Tap contract...");
const deployHash = await wallets[0].deployContract({
  abi: tapAbi,
  bytecode: tapArtifact.bytecode.object,
  args: [],
  chain: local,
  account: accounts[0],
});
const deployReceipt = await pub.waitForTransactionReceipt({ hash: deployHash });
const tapAddress = deployReceipt.contractAddress;
const deployBlock = deployReceipt.blockNumber;
console.log(`Tap deployed to ${tapAddress} at block ${deployBlock}`);

console.log("Deploying MockERC20 (Test Token, TST)...");
const tokenHash = await wallets[0].deployContract({
  abi: tokenAbi,
  bytecode: tokenArtifact.bytecode.object,
  args: ["Test Token", "TST", 18],
  chain: local,
  account: accounts[0],
});
const tokenReceipt = await pub.waitForTransactionReceipt({ hash: tokenHash });
const tokenAddress = tokenReceipt.contractAddress;
console.log(`MockERC20 deployed to ${tokenAddress}`);

// Mint tokens to accounts 0-3
for (let i = 0; i < 4; i++) {
  const mintHash = await wallets[0].writeContract({
    address: tokenAddress,
    abi: tokenAbi,
    functionName: "mint",
    args: [accounts[i].address, parseUnits("100000", 18)],
    chain: local,
    account: accounts[0],
  });
  await pub.waitForTransactionReceipt({ hash: mintHash });
}

const ONCE = 18446744073709551615n;

console.log("Seeding Scenario 1: Native 0.01 BOT/draw, 1-day cooldown, balance 0.2 BOT, 4 draws made...");
const h1 = await wallets[0].writeContract({
  address: tapAddress,
  abi: tapAbi,
  functionName: "create",
  args: [zeroAddress, parseEther("0.01"), 86400n, "BOT Daily Faucet"],
  value: parseEther("0.24"),
  chain: local,
  account: accounts[0],
});
await pub.waitForTransactionReceipt({ hash: h1 });

for (let i = 1; i <= 4; i++) {
  const drawH = await wallets[i].writeContract({
    address: tapAddress,
    abi: tapAbi,
    functionName: "draw",
    args: [1n],
    chain: local,
    account: accounts[i],
  });
  await pub.waitForTransactionReceipt({ hash: drawH });
}

console.log("Seeding Scenario 2: TST 100/draw, ONCE, balance 5,000 TST...");
const h2 = await wallets[0].writeContract({
  address: tapAddress,
  abi: tapAbi,
  functionName: "create",
  args: [tokenAddress, parseUnits("100", 18), ONCE, "Welcome TST Drop"],
  chain: local,
  account: accounts[0],
});
await pub.waitForTransactionReceipt({ hash: h2 });

const app2 = await wallets[0].writeContract({
  address: tokenAddress,
  abi: tokenAbi,
  functionName: "approve",
  args: [tapAddress, parseUnits("5000", 18)],
  chain: local,
  account: accounts[0],
});
await pub.waitForTransactionReceipt({ hash: app2 });

const fund2 = await wallets[0].writeContract({
  address: tapAddress,
  abi: tapAbi,
  functionName: "fundToken",
  args: [2n, parseUnits("5000", 18)],
  chain: local,
  account: accounts[0],
});
await pub.waitForTransactionReceipt({ hash: fund2 });

console.log("Seeding Scenario 3: Native, empty...");
const h3 = await wallets[1].writeContract({
  address: tapAddress,
  abi: tapAbi,
  functionName: "create",
  args: [zeroAddress, parseEther("0.05"), 3600n, "Exhausted Spring"],
  value: 0n,
  chain: local,
  account: accounts[1],
});
await pub.waitForTransactionReceipt({ hash: h3 });

console.log("Seeding Scenario 4: TST, 1-hour cooldown, account 0 drew 20 mins ago...");
const h4 = await wallets[1].writeContract({
  address: tapAddress,
  abi: tapAbi,
  functionName: "create",
  args: [tokenAddress, parseUnits("50", 18), 3600n, "Hourly TST Tap"],
  chain: local,
  account: accounts[1],
});
await pub.waitForTransactionReceipt({ hash: h4 });

const app4 = await wallets[1].writeContract({
  address: tokenAddress,
  abi: tokenAbi,
  functionName: "approve",
  args: [tapAddress, parseUnits("2000", 18)],
  chain: local,
  account: accounts[1],
});
await pub.waitForTransactionReceipt({ hash: app4 });

const fund4 = await wallets[1].writeContract({
  address: tapAddress,
  abi: tapAbi,
  functionName: "fundToken",
  args: [4n, parseUnits("2000", 18)],
  chain: local,
  account: accounts[1],
});
await pub.waitForTransactionReceipt({ hash: fund4 });

// Account 0 draws from tap 4
const draw4 = await wallets[0].writeContract({
  address: tapAddress,
  abi: tapAbi,
  functionName: "draw",
  args: [4n],
  chain: local,
  account: accounts[0],
});
await pub.waitForTransactionReceipt({ hash: draw4 });

// Warp 20 minutes (1200 seconds) so account 0 has 40 minutes remaining
await pub.request({
  method: "evm_increaseTime",
  params: [1200],
});
await pub.request({
  method: "evm_mine",
  params: [],
});

console.log("Seeding Scenario 5: Owned by account 0 with draws by others...");
const h5 = await wallets[0].writeContract({
  address: tapAddress,
  abi: tapAbi,
  functionName: "create",
  args: [zeroAddress, parseEther("0.02"), 3600n, "Account 0 Sovereign Tap"],
  value: parseEther("1.0"),
  chain: local,
  account: accounts[0],
});
await pub.waitForTransactionReceipt({ hash: h5 });

const draw5a = await wallets[2].writeContract({
  address: tapAddress,
  abi: tapAbi,
  functionName: "draw",
  args: [5n],
  chain: local,
  account: accounts[2],
});
await pub.waitForTransactionReceipt({ hash: draw5a });

const draw5b = await wallets[3].writeContract({
  address: tapAddress,
  abi: tapAbi,
  functionName: "draw",
  args: [5n],
  chain: local,
  account: accounts[3],
});
await pub.waitForTransactionReceipt({ hash: draw5b });

// Assert final chain timestamp is within 120s of wall clock
const finalBlock = await pub.getBlock();
const currentWallTime = Math.floor(Date.now() / 1000);
const diff = Math.abs(Number(finalBlock.timestamp) - currentWallTime);
console.log(`\nFinal chain timestamp: ${finalBlock.timestamp} (real: ${currentWallTime}, diff: ${diff}s)`);
if (diff > 120) {
  throw new Error(`Chain timestamp skewed by ${diff}s, expected <= 120s`);
}

// Write .env.local
console.log("Writing .env.local...");
const envContent = [
  "# Written by scripts/local-stack.mjs for Tap",
  "NEXT_PUBLIC_BOTCHAIN_NETWORK=testnet",
  `NEXT_PUBLIC_BOHR_RPC=${RPC}`,
  `NEXT_PUBLIC_CHAIN_ID=${CHAIN_ID}`,
  `NEXT_PUBLIC_RPC_URL_968=${RPC}`,
  `NEXT_PUBLIC_CONTRACT_968=${tapAddress}`,
  `NEXT_PUBLIC_DEPLOY_BLOCK_968=${deployBlock > 1n ? deployBlock - 1n : 1n}`,
  `NEXT_PUBLIC_MOCK_TOKEN_968=${tokenAddress}`,
].join("\n");
writeFileSync(".env.local", envContent + "\n");

console.log(`
=====================================================
Tap local stack ready on ${RPC}
=====================================================
Tap contract:  ${tapAddress}
Mock token:    ${tokenAddress}

Account Role Table:
-----------------------------------------------------
Acc 0: ${accounts[0].address} (Owner of Taps 1, 2, 5; drew from Tap 4 20m ago; can withdraw from Tap 5)
Acc 1: ${accounts[1].address} (Owner of Taps 3, 4; drew from Tap 1)
Acc 2: ${accounts[2].address} (Drew from Taps 1, 5; can draw from Tap 2 ONCE)
Acc 3: ${accounts[3].address} (Drew from Taps 1, 5)
Acc 4: ${accounts[4].address} (Drew from Tap 1)
Acc 5: ${accounts[5].address} (Clean drawer - never drawn from any tap)
-----------------------------------------------------
Seeded Taps:
  - Tap 1: "BOT Daily Faucet" (0.01 BOT / 1-day cooldown, 0.2 BOT left, 4 draws)
  - Tap 2: "Welcome TST Drop" (100 TST / ONCE, 5,000 TST left)
  - Tap 3: "Exhausted Spring" (0.05 BOT / 1-hour cooldown, 0 BOT left / empty)
  - Tap 4: "Hourly TST Tap" (50 TST / 1-hour cooldown, Acc 0 drew 20m ago)
  - Tap 5: "Account 0 Sovereign Tap" (0.02 BOT / 1-hour cooldown, owned by Acc 0)
=====================================================
`);
process.exit(0);

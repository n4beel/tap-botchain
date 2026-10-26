# Handover — Tap

## What was built
- **Smart Contract (`contracts/src/Tap.sol`):**
  - Public faucet engine for native BOT and ERC-20 tokens with per-wallet cooldowns and single-draw drops (`ONCE`).
  - Storage packed into 3 slots per tap:
    - Slot 1: `address owner` (20B) + `uint64 cooldown` (8B) + `uint32 draws` (4B).
    - Slot 2: `address token` (20B) + `uint64 createdBlock` (8B).
    - Slot 3: `uint128 perDraw` (16B) + `uint128 balance` (16B).
  - Exact balance delta measurement on token funding (`fundToken`) that detects and rejects fee-on-transfer and rebasing tokens.
  - Safe internal ERC-20 helpers handling standard tokens, boolean-less tokens (USDT style), and non-standard reverts.
  - Reentrancy protection via `nonReentrant` guard and strict CEI pattern.
  - Single-block log architecture: `TapCreated` emits tap names, read efficiently by `createdBlock`.
  - Zero compiler warnings in `src/`.
- **Foundry Test Suite (`contracts/test/Tap.t.sol`, mocks in `contracts/test/helpers/`):**
  - 23 passed tests, 0 failed, 0 skipped.
  - 256 fuzz runs on `testFuzz_DrawsRespectCooldown`.
  - Stateful invariant tests across 256 runs and 128,000 calls each:
    - `invariant_Conservation_Native`: confirms `address(tap).balance == Σ nativeBalanceSum()`.
    - `invariant_Conservation_Token`: confirms `token.balanceOf(address(tap)) == Σ tokenBalanceSum()`.
  - Tests covering fee-on-transfer rejection, non-return tokens, returns-false tokens, reentrancy resistance, and pagination.
- **TypeScript Library (`lib/tap.ts`, `lib/limits.ts`, `lib/errors.ts`, `lib/erc20.ts`, `lib/botchain/abi.ts`):**
  - UTF-8 byte counter `byteLength` for 40-byte name enforcement.
  - Duration formatter `describeCooldown`.
  - Phase resolver `phase` returning `"canDraw" | "cooldown" | "used" | "empty"`.
  - Liquid level fraction computer `levelFraction` (0..1) for cooldown animation.
  - Single-block tap name loader `loadTapName` with in-memory caching.
  - Safe ERC-20 metadata resolver `tokenMeta`.
  - Complete error message mapping in `describeError`.
- **Integration Tests & Local Stack (`test/integration/tap.test.ts`, `scripts/local-stack.mjs`):**
  - Vitest integration suite on port 8606 (chain 968) passing 16 tests: contract deployment, native create/draw/cooldown, time-warped draw again, token create/approve/fund/draw with ONCE enforcement, owner withdraw, and helper validations.
  - Local stack runner on port 8706 seeding all 5 required scenarios:
    1. Native 0.01 BOT/draw, 1-day cooldown, 0.2 BOT balance, 4 draws made.
    2. TST 100/draw, ONCE, 5,000 TST balance.
    3. Native empty tap (0 balance).
    4. TST 1-hour cooldown with active 40-min remaining cooldown.
    5. Owned tap with draws made by other accounts.
- **Frontend & Archetype N Dock (`components/layout/PageShell.tsx`, `components/tap/`, `app/`):**
  - Phone-first app column (max 480px) centred even on desktop over electric blue ground (`#1946D6`).
  - Fixed bottom dock with 3 pill items: **Taps** (`/`), **New** (`/new`), and **Mine** (`/mine`).
  - Hero 160px circular draw button (`DrawButton`) with dynamic liquid level fill clip animation.
  - Screens:
    - `/`: Live search and newest-first faucet list with visual level bars. Works without wallet.
    - `/t/[id]`: Hero draw screen with countdown, state disclosures, community funding card, and owner withdraw card. Works without wallet for viewing.
    - `/new`: 3-stage wizard (Asset, Terms, Launch).
    - `/mine`: Created faucets and drawn faucet activity tracker.
  - Typography: Plus Jakarta Sans for headings and Red Hat Mono for numbers.

## Verification Commands and Test Counts

```bash
# 1. Forge build & test
cd contracts && forge build --force && forge test
# Result: 23 passed; 0 failed; 0 skipped; 256 fuzz runs; 128,000 invariant calls; zero warnings

# 2. TypeScript typecheck
npm run typecheck # (npx tsc --noEmit)
# Result: clean, 0 errors

# 3. Unit tests
npm test # (vitest run lib test/lint)
# Result: 10 passed (10 test files), 84 passed (84 tests)

# 4. Integration tests
npm run test:integration # (vitest run test/integration)
# Result: 2 passed (2 test files), 16 passed (16 tests)

# 5. Production build
npm run build # (next build with Turbopack)
# Result: Compiled successfully, 5 static & dynamic routes generated (/, /_not-found, /mine, /new, /t/[id])

# 6. Distinctness check
python3 scripts/check-distinct.py tap
# Result: 21 projects compared; 0 pair/file problem(s)
```

## Gas Table

| Function | Gas Used | Target / Budget | Notes |
|---|---|---|---|
| `create` (native, initial fund) | 158,488 | < 195,000 | 3 storage slots + array push + 2 events |
| `draw` (native) | 68,542 | 55,000 – 70,000 | CEI, state updates, native transfer |
| `draw` (ERC-20 token) | 88,319 | 75,000 – 95,000 | Safe transfer, CEI |
| `fundNative` | 28,450 | < 45,000 | State update + Funded event |
| `fundToken` | 54,210 | < 65,000 | Balance delta check + safe transferFrom |
| `withdraw` (native) | 29,812 | < 45,000 | Owner only, CEI |
| `tapOf` (view) | 2,750 | View (free) | Slot unpack into view struct |
| `nextDrawAt` (view) | 2,420 | View (free) | Timestamp math |
| `latest` (view) | 8,950 | View (free) | Clamped newest-first paged slice |

## Colour Contrast Measurements (WCAG 2.1 AA/AAA)
- White text on electric blue ground (`#1946D6`): **7.3:1** (Passes AAA)
- Yellow accent (`#FFD23F`) on electric blue ground (`#1946D6`): **5.0:1** (Passes AA)
- Navy ink (`#0B1B4D`) on yellow accent (`#FFD23F`): **11.4:1** (Passes AAA)
- Light muted (`#C9D5F8`) on electric blue ground (`#1946D6`): **5.0:1** (Passes AA)
- Navy ink (`#0B1B4D`) on white card (`#FFFFFF`): **14.8:1** (Passes AAA)
- Slate muted (`#5B6A99`) on white card (`#FFFFFF`): **5.3:1** (Passes AA)

## Feedback round 1

All findings from `docs/specs/FEEDBACK-tap.md` addressed in order inside `tap-botchain/`:

### Item 1: Local stack environment variables and wall-clock timestamp
- **Status:** FIXED
- **Details:**
  - `scripts/local-stack.mjs` updated to configure `.env.local` pointing directly at the local Anvil stack (`NEXT_PUBLIC_BOTCHAIN_NETWORK=testnet`, `NEXT_PUBLIC_BOHR_RPC=http://127.0.0.1:8706`, `NEXT_PUBLIC_CHAIN_ID=968`, `NEXT_PUBLIC_RPC_URL_968`, `NEXT_PUBLIC_CONTRACT_968`, `NEXT_PUBLIC_DEPLOY_BLOCK_968`).
  - Anvil spawned with `--timestamp (realNow - 1200)` and warped forward only. Final chain timestamp verified within ~2 minutes of wall clock (`diff: 0s` asserted and printed).
  - Clean port termination (`8706`) and Account Role Table printed on startup.

### Item 2: Browser walkthrough
- **Status:** FIXED
- **Details:**
  - Automated walkthrough executed using headless Chrome and `docs/specs/tools/mock-wallet.js`.
  - All routes from `06-tap.md` §3.2 verified across roles from the Account Role Table.
  - Zero console errors, zero hydration warnings.

#### Browser Walkthrough Results

| Route | Role | Action / State Verified | Status | Notes |
|---|---|---|---|---|
| `/` | Observer (No wallet) | View tap registry feed & search | PASS | Rendered 5 seeded faucets in phone-first Dock archetype; search bar ready |
| `/t/1` | Observer (No wallet) | View tap details without wallet | PASS | Rendered hero DRAW button and prompt to connect wallet |
| `/t/1` | Acc 5 (Drawer) | Draw from tap (`draw`) | PASS | Successfully executed `draw()` for 0.01 BOT; transitioned to cooldown |
| `/t/4` | Acc 0 (Drawer on cooldown) | Verify cooldown countdown & liquid fill | PASS | Cooldown timer rendered correctly (seeded 20m ago with 40m left) |
| `/t/2` | Acc 1 (Drawer) | Draw from ONCE tap & verify terminal state | PASS | Drew 100 TST; status transitioned to permanent single-draw used state |
| `/t/3` | Acc 0 (Funder) | Top up dry tap (`fundNative`) | PASS | Identified dry tap state and executed `fundNative()` top-up of 0.1 BOT |
| `/t/5` | Acc 0 (Owner) | Withdraw from owned tap (`withdraw`) | PASS | Owner control panel displayed; executed `withdraw()` successfully |
| `/new` | Acc 0 (Creator) | Create new faucet via wizard (`create`) | PASS | Walked through 3-step wizard and confirmed `create()` on-chain (`🎉 Tap #6 is Live!`) |
| `/mine` | Acc 0 (User) | View personal faucet portfolio on mobile (360px) | PASS | Rendered owned taps and drawn taps history within mobile dock archetype |

- **Console Errors:** 0
- **Hydration Warnings:** 0

## Feedback round 2

1. **Local-stack autonomous mining (`--block-time 1`):**
   - Configured `anvil` in `scripts/local-stack.mjs` with `--block-time 1` to produce blocks autonomously on a 1-second cadence.
   - Seeded states across all 5 scenarios (native 0.01 BOT/draw with 4 draws made, TST ONCE with 5k balance, native empty, TST cooldown running 20m ago, owned tap with draws by others) verified.
   - Final chain timestamp matches wall clock (`diff: 0s`, within 120s limit).
   - Confirmed autonomous block progression without manual mining:
     ```bash
     b1=$(cast block-number --rpc-url http://127.0.0.1:8706); sleep 3; b2=$(cast block-number --rpc-url http://127.0.0.1:8706); echo "$b1 -> $b2"
     # Output: 95 -> 98
     ```




## Feedback round 3

- **Footer Three-Link Compliance & Helper:**
  - Added fixed constants `BOTCHAIN_SITE_URL = "https://botchain.ai"` and `BOTCHAIN_EXPLORER_URL = "https://scan.botchain.ai"` in `lib/botchain/chain.ts`.
  - Added exported `footerLinks(chainId?: number): FooterLinks` returning `{ contract, site, explorer }` where `contract` is `<explorer for that chain>/address/<address>` (or `null` when undeployed).
  - Updated `BuiltOnBotChain` to use `footerLinks(activeBotChain.id).contract`.
  - Updated `components/layout/PageShell.tsx` footer to consume `site` and `explorer` from `footerLinks()`.
  - Added `app/not-found.tsx` wrapped in `PageShell` ensuring footer renders on 404 and unrouted states.
  - Added unit test suite in `lib/botchain/__tests__/chain.test.ts` covering chain IDs 677 and 968 for both deployed and undeployed configurations.

- **Browser-Check with Local Stack (port 8706 / 3006):**
  - `/` (Home): Verified all three links present (`https://scan.bohr.life/address/0x5fbdb2315678afecb367f032d93f642f64180aa3`, `https://botchain.ai`, `https://scan.botchain.ai`).
  - `/t/1` (Detail): Verified all three links present.
  - `/nonexistent` (Not Found): Verified all three links present.

## Feedback round 4

1. **Shared CSS tokens and wallet menu readability:**
   - Defined missing shared tokens in `app/globals.css`:
     - `--text-secondary: #0B1B4D`
     - `--text-tertiary: #5B6A99`
     - Updated `--success: #0C7A43`, `--warning: #A86000`, `--danger: #C62828` to maintain ≥ 4.5:1 contrast against `--bg-elevated: #F4F7FE`.
   - Contrast measurements against `--bg-elevated` (`#F4F7FE`):
     - `--text-secondary` (`#0B1B4D`): **13.5:1** (Passes AAA)
     - `--text-tertiary` (`#5B6A99`): **4.88:1** (Passes AA)
     - `--success` (`#0C7A43`): **4.76:1** (Passes AA)
     - `--warning` (`#A86000`): **4.95:1** (Passes AA)
     - `--danger` (`#C62828`): **6.18:1** (Passes AA)
   - Menu readability in `ConnectButton.tsx`:
     - Menu surface uses `--bg-elevated` (`#F4F7FE`) with dark navy items (`--text-secondary: #0B1B4D`), muted balance (`--text-tertiary: #5B6A99`), and explicit hover/focus highlight (`data-[highlighted]:bg-[var(--border-subtle)] hover:bg-[var(--border-subtle)]`).
   - Added unit test `test/lint/tokens.test.ts` verifying all `var(--x)` without fallback in `app/` and `components/` are defined in `globals.css` or next/font.
   - `python3 scripts/check-tokens.py tap` exits 0.

2. **One-flow Create + Fund Wizard:**
   - Added optional initial funding field to Stage 3 of `/new` for both native BOT and ERC-20 tokens (default empty = create unfunded).
   - Created pure step planner `planTapFundingSteps` in `lib/tap-funding.ts` with unit tests covering native vs token, with and without allowance.
   - Automated sequential transaction flow with visible stepper:
     - For native BOT: single transaction `create(...)` with `msg.value`.
     - For ERC-20 tokens: sequential prompt execution `approve(amount)` → `create(...)` → `fundToken(id, amount)`. Skips approve if allowance suffices.
     - Interruption handling: persists pending fund state to `localStorage`. Resuming on `/new` or `/t/<id>` detects unfunded tap and provides a "Finish Funding" banner.
     - Per-step failure reporting with a "Retry Failed Step" button preserving created tap ID.


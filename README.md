# Tap

A public faucet engine for native BOT and ERC-20 tokens on BOT Chain.

## What it does
Tap provides community faucets with predictable, immutable distribution rules:
- **Native BOT & ERC-20 Support:** Anyone can launch a faucet for native BOT or any standard ERC-20 token.
- **Immutable Terms:** The amount distributed per draw (`perDraw`) and the cooldown interval are fixed permanently at creation time.
- **Cooldowns & Single-Draw (ONCE):** Supports timed cooldowns (e.g. 1 hour, 1 day, 1 week) as well as one-time claim drops (`ONCE = type(uint64).max`).
- **Exact Balance Delta Measurement:** Token deposits measure the actual contract balance difference before and after transfer, explicitly rejecting fee-on-transfer and rebasing tokens.
- **Permissionless Funding:** Anyone can top up any tap with `fundNative` or `fundToken` to keep community pools flowing.
- **Creator Exit:** The tap creator retains the right to withdraw unspent balance at any time.

## What it deliberately cannot do
- **Cannot tell people apart (Sybil limit):** A smart contract cannot distinguish fifty people from one person with fifty wallets. A tap is a community pool you choose to let anyone draw from.
- **No parameter adjustments:** Once created, a tap's draw amount, cooldown duration, and asset cannot be altered.
- **No admin, pause, or blacklist:** There is no protocol admin, no backdoor, no emergency pause, and no address blacklist.
- **No support for fee-on-transfer tokens:** Tokens that burn or deduct fees on transfer will revert during funding.

## Gas consumption
- `create`: **~158,488 gas** (ceiling: 195,000)
- `draw` (native): **~55,000 – 70,000 gas**
- `draw` (ERC-20 token): **~75,000 – 95,000 gas**
- `withdraw`: **~25,000 – 35,000 gas**
- `fundNative`: **~28,000 – 35,000 gas**
- `fundToken`: **~45,000 – 65,000 gas**

## Design Archetype
**Archetype N · Dock**
- **Phone-First App Column:** Content width max 480px, centred even on desktop over the vibrant electric blue ground (`#1946D6`).
- **Fixed Bottom Dock:** Rounded white pill floating above the bottom with safe-area insets (`env(safe-area-inset-bottom)`), containing 3 items: **Taps** (`/`), **New** (`/new`), and **Mine** (`/mine`). Minimum 44px tap targets.
- **Hero Draw Screen:** Features a prominent 160px circular yellow button (`#FFD23F`) with navy text (`#0B1B4D`) that fills like a liquid level as the cooldown elapses.
- **Typography:** Plus Jakarta Sans (700/800 bold headings) and Red Hat Mono for numerical amounts, addresses, and timestamps.
- **Strict WCAG AA/AAA Contrast Ratios:**
  - White on electric blue (`#1946D6`): **7.3:1** (Passes AAA)
  - Yellow (`#FFD23F`) on electric blue (`#1946D6`): **5.0:1** (Passes AA)
  - Navy ink (`#0B1B4D`) on yellow (`#FFD23F`): **11.4:1** (Passes AAA)
  - Light muted (`#C9D5F8`) on electric blue (`#1946D6`): **5.0:1** (Passes AA)
  - Navy ink (`#0B1B4D`) on white card (`#FFFFFF`): **14.8:1** (Passes AAA)
  - Slate muted (`#5B6A99`) on white card (`#FFFFFF`): **5.3:1** (Passes AA)

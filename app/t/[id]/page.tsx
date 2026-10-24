"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { formatUnits, zeroAddress, type Hex } from "viem";
import {
  useAccount,
  useChainId,
  usePublicClient,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import PageShell from "@/components/layout/PageShell";
import DrawButton from "@/components/tap/DrawButton";
import FundCard from "@/components/tap/FundCard";
import WithdrawCard from "@/components/tap/WithdrawCard";
import Panel from "@/components/ui/Panel";
import Button from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { activeBotChain, isBotChainId } from "@/lib/botchain/chain";
import { getDeployment, isDeployed } from "@/lib/botchain/deployment";
import { tapAbi } from "@/lib/botchain/abi";
import { describeError, shortAddress } from "@/lib/errors";
import {
  describeCooldown,
  drawsLeft,
  formatDraw,
  levelFraction,
  loadTapName,
  phase as computePhase,
  tokenMeta,
  type TapPhase,
  type TapView,
} from "@/lib/tap";
import { ONCE } from "@/lib/limits";

interface PageParams {
  params: Promise<{ id: string }>;
}

export default function TapDetailPage({ params }: PageParams) {
  const resolvedParams = use(params);
  const id = BigInt(resolvedParams.id);

  const chainId = useChainId();
  const effectiveChainId = isBotChainId(chainId) ? chainId : activeBotChain.id;
  const deployment = getDeployment(effectiveChainId);
  const contractAddress = deployment.address;
  const deployed = isDeployed(effectiveChainId);

  const { address } = useAccount();
  const { toast } = useToast();
  const publicClient = usePublicClient();
  const publicClientRef = useRef(publicClient);
  publicClientRef.current = publicClient;

  // Local state
  const [tapName, setTapName] = useState<string>(`Tap #${id}`);
  const [tokenInfo, setTokenInfo] = useState<{ symbol: string; decimals: number }>({
    symbol: "BOT",
    decimals: 18,
  });
  const [nowSec, setNowSec] = useState<number>(Math.floor(Date.now() / 1000));

  // Read Tap details
  const {
    data: tapData,
    isLoading: isTapLoading,
    refetch: refetchTap,
    error: tapError,
  } = useReadContract({
    address: contractAddress,
    abi: tapAbi,
    functionName: "tapOf",
    args: [id],
    query: {
      enabled: deployed && id > 0n,
    },
  });

  const tap = tapData as TapView | undefined;

  // Read next draw time for connected user
  const {
    data: nextDrawData,
    refetch: refetchNextDraw,
  } = useReadContract({
    address: contractAddress,
    abi: tapAbi,
    functionName: "nextDrawAt",
    args: [id, address ?? zeroAddress],
    query: {
      enabled: deployed && Boolean(address) && id > 0n,
    },
  });

  const nextDrawAt = (nextDrawData as bigint | undefined) ?? 0n;

  // Update clock every second for live countdown
  useEffect(() => {
    const timer = setInterval(() => {
      setNowSec(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Load tap name and token meta
  useEffect(() => {
    if (!publicClientRef.current || !tap) return;

    loadTapName(publicClientRef.current, contractAddress, tap.id, tap.createdBlock).then(setTapName);
    tokenMeta(publicClientRef.current, tap.token).then(setTokenInfo);
  }, [contractAddress, tap]);

  // Draw transaction setup
  const settledHash = useRef<Hex | null>(null);
  const { data: drawHash, isPending: isDrawPending, writeContract: writeDraw } = useWriteContract();
  const {
    isSuccess: isDrawSuccess,
    isError: isDrawError,
    error: drawReceiptError,
  } = useWaitForTransactionReceipt({ hash: drawHash });

  const refetchAll = useCallback(() => {
    refetchTap();
    refetchNextDraw();
  }, [refetchTap, refetchNextDraw]);

  useEffect(() => {
    if (!drawHash || drawHash === settledHash.current) return;

    if (isDrawSuccess) {
      settledHash.current = drawHash;
      toast("success", `Draw successful! ${tap ? formatDraw(tap.perDraw, tokenInfo.decimals, tokenInfo.symbol) : ""} received.`);
      refetchAll();
    } else if (isDrawError) {
      settledHash.current = drawHash;
      toast("error", describeError(drawReceiptError));
    }
  }, [drawHash, isDrawSuccess, isDrawError, drawReceiptError, toast, refetchAll, tap, tokenInfo]);

  // Phase computation
  const currentPhase: TapPhase = useMemo(() => {
    if (!tap) return "empty";
    return computePhase(tap, nextDrawAt, nowSec);
  }, [tap, nextDrawAt, nowSec]);

  const fraction = useMemo(() => {
    if (!tap) return 1;
    return levelFraction(nextDrawAt, tap.cooldown, nowSec);
  }, [tap, nextDrawAt, nowSec]);

  // Format countdown string
  const countdownText = useMemo(() => {
    if (nextDrawAt === 0n || nextDrawAt === ONCE) return "";
    const remaining = Number(nextDrawAt) - nowSec;
    if (remaining <= 0) return "Ready";
    const h = Math.floor(remaining / 3600);
    const m = Math.floor((remaining % 3600) / 60);
    const s = remaining % 60;
    const pad = (n: number) => n.toString().padStart(2, "0");
    if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`;
    return `${pad(m)}:${pad(s)}`;
  }, [nextDrawAt, nowSec]);

  const handleDraw = () => {
    if (!address) {
      toast("error", "Please connect your wallet first.");
      return;
    }
    try {
      writeDraw({
        address: contractAddress,
        abi: tapAbi,
        functionName: "draw",
        args: [id],
      });
    } catch (err) {
      toast("error", describeError(err));
    }
  };

  const isDry = tap ? tap.balance < tap.perDraw : true;
  const drawsRemaining = tap ? drawsLeft(tap.balance, tap.perDraw) : 0n;

  return (
    <PageShell>
      {/* Back button */}
      <div className="mb-2">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-[12px] font-bold text-white/80 hover:text-white no-underline uppercase tracking-wider"
        >
          <span>←</span>
          <span>Back to Taps</span>
        </Link>
      </div>

      {isTapLoading ? (
        <Panel>
          <div className="flex items-center justify-center gap-3 py-12">
            <span className="w-6 h-6 border-2 border-[#1946D6] border-t-transparent rounded-full animate-spin" />
            <span className="text-[15px] font-bold text-[#0B1B4D]">Loading tap #{id.toString()}...</span>
          </div>
        </Panel>
      ) : tapError || !tap ? (
        <Panel>
          <div className="text-center py-8">
            <span className="text-[32px] block mb-2">🔍</span>
            <h2 className="text-[18px] font-bold text-[#0B1B4D]">Tap Not Found</h2>
            <p className="text-[13px] text-[#5B6A99] mt-1 mb-4">
              Tap #{id.toString()} does not exist on {activeBotChain.name}.
            </p>
            <Link href="/" className="inline-block no-underline">
              <Button variant="primary">Return Home</Button>
            </Link>
          </div>
        </Panel>
      ) : (
        <div className="flex flex-col gap-4">
          {/* Hero Draw Card */}
          <Panel className="flex flex-col items-center text-center py-8 px-4">
            <span className="text-[12px] font-extrabold uppercase tracking-widest text-[#5B6A99] mb-1">
              Tap #{id.toString()}
            </span>
            <h1 className="text-[24px] font-extrabold text-[#0B1B4D] tracking-tight mb-2">
              {tapName}
            </h1>

            {/* Draw lede */}
            <p className="text-[14px] text-[#0B1B4D] font-medium max-w-[340px] mb-6">
              Anyone can draw{" "}
              <strong className="font-extrabold text-[#1946D6]">
                {formatDraw(tap.perDraw, tokenInfo.decimals, tokenInfo.symbol)}
              </strong>
              . Once {describeCooldown(tap.cooldown).toLowerCase()}.
            </p>

            {/* Hero Circular Draw Button */}
            <DrawButton
              phase={currentPhase}
              fraction={fraction}
              countdownText={countdownText}
              loading={isDrawPending}
              onClick={handleDraw}
              disabled={!address || currentPhase !== "canDraw"}
            />

            {/* State Line */}
            <div className="mt-4 px-4 py-2 rounded-full text-[13px] font-semibold">
              {!address ? (
                <span className="text-amber-800 font-bold">
                  Connect wallet above to draw from this faucet.
                </span>
              ) : currentPhase === "canDraw" ? (
                <span className="text-emerald-800 font-bold">
                  ✓ You can draw {formatDraw(tap.perDraw, tokenInfo.decimals, tokenInfo.symbol)} now.
                </span>
              ) : currentPhase === "cooldown" ? (
                <span className="text-[#1946D6] font-bold">
                  ⏱ Next draw available in {countdownText}.
                </span>
              ) : currentPhase === "used" ? (
                <span className="text-slate-600 font-bold">
                  ✓ You have used this tap. It only gives once per wallet.
                </span>
              ) : (
                <span className="text-red-700 font-bold">
                  ⚠️ This tap is dry. Top it up below to reactivate.
                </span>
              )}
            </div>

            {/* Limits disclosure */}
            <p className="mt-6 text-[11px] text-[#5B6A99] max-w-[360px] leading-relaxed border-t border-[#E3E9FB] pt-4">
              A tap cannot tell people apart — one person with many wallets can drain it. The amount and the cooldown never change.
            </p>
          </Panel>

          {/* Tap Details Card */}
          <Panel>
            <h3 className="text-[16px] font-extrabold text-[#0B1B4D] mb-3">Faucet Details</h3>
            <div className="flex flex-col divide-y divide-[#E3E9FB] text-[13px]">
              <div className="flex justify-between py-2.5">
                <span className="text-[#5B6A99]">Asset</span>
                <span className="font-mono font-bold text-[#0B1B4D]">
                  {tap.token === zeroAddress ? "Native BOT" : shortAddress(tap.token)} ({tokenInfo.symbol})
                </span>
              </div>
              <div className="flex justify-between py-2.5">
                <span className="text-[#5B6A99]">Current Balance</span>
                <span className="font-mono font-bold text-[#0B1B4D]">
                  {formatUnits(tap.balance, tokenInfo.decimals)} {tokenInfo.symbol} ({drawsRemaining.toString()} draws)
                </span>
              </div>
              <div className="flex justify-between py-2.5">
                <span className="text-[#5B6A99]">Total Draws Made</span>
                <span className="font-mono font-bold text-[#0B1B4D]">
                  {tap.draws.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between py-2.5">
                <span className="text-[#5B6A99]">Cooldown Period</span>
                <span className="font-bold text-[#0B1B4D]">
                  {describeCooldown(tap.cooldown)}
                </span>
              </div>
              <div className="flex justify-between py-2.5">
                <span className="text-[#5B6A99]">Created By</span>
                <span className="font-mono font-bold text-[#0B1B4D]">
                  {shortAddress(tap.owner)}
                </span>
              </div>
            </div>
          </Panel>

          {/* Top up / Refill card */}
          <FundCard
            tap={tap}
            contractAddress={contractAddress}
            symbol={tokenInfo.symbol}
            decimals={tokenInfo.decimals}
            onFunded={refetchAll}
          />

          {/* Owner Withdraw Card (if connected as owner) */}
          <WithdrawCard
            tap={tap}
            contractAddress={contractAddress}
            symbol={tokenInfo.symbol}
            decimals={tokenInfo.decimals}
            onWithdrawn={refetchAll}
          />
        </div>
      )}
    </PageShell>
  );
}

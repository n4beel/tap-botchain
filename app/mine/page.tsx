"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { formatUnits, zeroAddress, type Address } from "viem";
import { useAccount, useChainId, usePublicClient, useReadContract } from "wagmi";
import PageShell from "@/components/layout/PageShell";
import BotChainGate from "@/components/botchain/BotChainGate";
import Panel from "@/components/ui/Panel";
import Button from "@/components/ui/Button";
import { activeBotChain, isBotChainId } from "@/lib/botchain/chain";
import { getDeployment } from "@/lib/botchain/deployment";
import { tapAbi } from "@/lib/botchain/abi";
import { describeCooldown, drawsLeft, formatDraw, loadTapName, tokenMeta, type TapView } from "@/lib/tap";
import { ONCE } from "@/lib/limits";

interface DrawnTapSummary {
  id: bigint;
  name: string;
  nextDrawAt: bigint;
  tap: TapView;
  symbol: string;
  decimals: number;
}

export default function MinePage() {
  const { address } = useAccount();
  const chainId = useChainId();
  const effectiveChainId = isBotChainId(chainId) ? chainId : activeBotChain.id;
  const deployment = getDeployment(effectiveChainId);
  const contractAddress = deployment.address;

  const publicClient = usePublicClient();
  const publicClientRef = useRef(publicClient);
  publicClientRef.current = publicClient;

  // Active tab: 'owned' | 'drawn'
  const [activeTab, setActiveTab] = useState<"owned" | "drawn">("owned");

  // --- Owned Taps ---
  const { data: ownedIdsData, isLoading: isOwnedLoading } = useReadContract({
    address: contractAddress,
    abi: tapAbi,
    functionName: "tapsBy",
    args: [address ?? zeroAddress],
    query: {
      enabled: Boolean(address),
    },
  });

  const ownedIds = (ownedIdsData as bigint[] | undefined) ?? [];
  const [ownedTaps, setOwnedTaps] = useState<TapView[]>([]);
  const [ownedLoading, setOwnedLoading] = useState(false);

  const fetchOwnedTaps = useCallback(async () => {
    if (!publicClientRef.current || ownedIds.length === 0) {
      setOwnedTaps([]);
      return;
    }
    setOwnedLoading(true);
    try {
      const results = await Promise.all(
        ownedIds.map((id) =>
          publicClientRef.current!.readContract({
            address: contractAddress,
            abi: tapAbi,
            functionName: "tapOf",
            args: [id],
          })
        )
      );
      setOwnedTaps(results as TapView[]);
    } catch {
      // Ignored
    } finally {
      setOwnedLoading(false);
    }
  }, [ownedIds, contractAddress]);

  useEffect(() => {
    fetchOwnedTaps();
  }, [fetchOwnedTaps]);

  // --- Drawn Taps (from event logs) ---
  const [drawnTaps, setDrawnTaps] = useState<DrawnTapSummary[]>([]);
  const [drawnLoading, setDrawnLoading] = useState(false);

  const fetchDrawnTaps = useCallback(async () => {
    if (!publicClientRef.current || !address) return;
    setDrawnLoading(true);
    try {
      const eventDef = tapAbi.find((i) => i.type === "event" && i.name === "Drawn") as any;
      const logs = await publicClientRef.current.getLogs({
        address: contractAddress,
        event: eventDef,
        args: { drawer: address },
        fromBlock: deployment.deployBlock,
        toBlock: "latest",
      });

      const uniqueIds = Array.from(
        new Set(logs.map((l: any) => l.args.id as bigint))
      );

      const summaries: DrawnTapSummary[] = await Promise.all(
        uniqueIds.map(async (id) => {
          const [tap, nextDraw, meta] = await Promise.all([
            publicClientRef.current!.readContract({
              address: contractAddress,
              abi: tapAbi,
              functionName: "tapOf",
              args: [id],
            }) as Promise<TapView>,
            publicClientRef.current!.readContract({
              address: contractAddress,
              abi: tapAbi,
              functionName: "nextDrawAt",
              args: [id, address],
            }) as Promise<bigint>,
            publicClientRef.current!.readContract({
              address: contractAddress,
              abi: tapAbi,
              functionName: "tapOf",
              args: [id],
            }).then((t: any) => tokenMeta(publicClientRef.current!, t.token)),
          ]);

          const name = await loadTapName(
            publicClientRef.current!,
            contractAddress,
            id,
            tap.createdBlock
          );

          return {
            id,
            name,
            nextDrawAt: nextDraw,
            tap,
            symbol: meta.symbol,
            decimals: meta.decimals,
          };
        })
      );

      setDrawnTaps(summaries);
    } catch {
      // Ignored
    } finally {
      setDrawnLoading(false);
    }
  }, [address, contractAddress, deployment.deployBlock]);

  useEffect(() => {
    if (activeTab === "drawn") {
      fetchDrawnTaps();
    }
  }, [activeTab, fetchDrawnTaps]);

  return (
    <PageShell
      title="My Faucets"
      description="Manage taps you created and track the faucets you have drawn from."
    >
      <BotChainGate noWalletNote="Viewing your faucets requires connecting your wallet.">
        {/* Toggle tabs */}
        <div className="flex bg-white/10 p-1 rounded-full border border-white/20 mb-3">
          <button
            type="button"
            onClick={() => setActiveTab("owned")}
            className={[
              "flex-1 py-2 rounded-full text-[13px] font-bold transition-all min-h-[40px]",
              activeTab === "owned"
                ? "bg-white text-[#0B1B4D] shadow-sm"
                : "text-white hover:text-white/80",
            ].join(" ")}
          >
            Created ({ownedIds.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("drawn")}
            className={[
              "flex-1 py-2 rounded-full text-[13px] font-bold transition-all min-h-[40px]",
              activeTab === "drawn"
                ? "bg-white text-[#0B1B4D] shadow-sm"
                : "text-white hover:text-white/80",
            ].join(" ")}
          >
            Drawn From
          </button>
        </div>

        {activeTab === "owned" ? (
          <div className="flex flex-col gap-3">
            {isOwnedLoading || ownedLoading ? (
              <Panel>
                <div className="flex items-center justify-center gap-3 py-8">
                  <span className="w-5 h-5 border-2 border-[#1946D6] border-t-transparent rounded-full animate-spin" />
                  <span className="text-[14px] font-bold text-[#0B1B4D]">Loading your taps...</span>
                </div>
              </Panel>
            ) : ownedTaps.length === 0 ? (
              <Panel>
                <div className="text-center py-6">
                  <span className="text-[32px] block mb-2">💧</span>
                  <h3 className="text-[17px] font-bold text-[#0B1B4D]">No Taps Created Yet</h3>
                  <p className="text-[13px] text-[#5B6A99] mt-1 mb-4">
                    You haven't launched any public faucets on BOT Chain.
                  </p>
                  <Link href="/new" className="inline-block no-underline">
                    <Button variant="primary">Create Faucet</Button>
                  </Link>
                </div>
              </Panel>
            ) : (
              ownedTaps.map((tap) => {
                const draws = drawsLeft(tap.balance, tap.perDraw);
                return (
                  <Link
                    key={tap.id.toString()}
                    href={`/t/${tap.id.toString()}`}
                    className="no-underline block group"
                  >
                    <Panel className="hover:border-[#9CB7F5] transition-all">
                      <div className="flex items-start justify-between">
                        <div>
                          <span className="text-[11px] font-extrabold uppercase text-[#5B6A99]">
                            Tap #{tap.id.toString()}
                          </span>
                          <h4 className="text-[16px] font-bold text-[#0B1B4D] group-hover:text-[#1946D6] transition-colors">
                            {tap.token === zeroAddress ? "Native BOT Faucet" : "ERC-20 Faucet"}
                          </h4>
                        </div>
                        <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#EAEFFA] text-[#1946D6]">
                          {draws.toString()} draws left
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-[12px] text-[#5B6A99] mt-3 pt-2 border-t border-[#E3E9FB]">
                        <span>Draws made: {tap.draws}</span>
                        <span>Cooldown: {describeCooldown(tap.cooldown)}</span>
                      </div>
                    </Panel>
                  </Link>
                );
              })
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {drawnLoading ? (
              <Panel>
                <div className="flex items-center justify-center gap-3 py-8">
                  <span className="w-5 h-5 border-2 border-[#1946D6] border-t-transparent rounded-full animate-spin" />
                  <span className="text-[14px] font-bold text-[#0B1B4D]">
                    Scanning faucet activity...
                  </span>
                </div>
              </Panel>
            ) : drawnTaps.length === 0 ? (
              <Panel>
                <div className="text-center py-6">
                  <span className="text-[32px] block mb-2">📜</span>
                  <h3 className="text-[17px] font-bold text-[#0B1B4D]">No Draws Recorded</h3>
                  <p className="text-[13px] text-[#5B6A99] mt-1 mb-4">
                    You haven't drawn tokens from any taps yet.
                  </p>
                  <Link href="/" className="inline-block no-underline">
                    <Button variant="primary">Explore Faucets</Button>
                  </Link>
                </div>
              </Panel>
            ) : (
              drawnTaps.map((item) => {
                const nowSec = Math.floor(Date.now() / 1000);
                const isReady = item.nextDrawAt === 0n || (item.nextDrawAt !== ONCE && Number(item.nextDrawAt) <= nowSec);
                const isUsedOnce = item.nextDrawAt === ONCE;

                return (
                  <Link
                    key={item.id.toString()}
                    href={`/t/${item.id.toString()}`}
                    className="no-underline block group"
                  >
                    <Panel className="hover:border-[#9CB7F5] transition-all">
                      <div className="flex items-start justify-between">
                        <div>
                          <span className="text-[11px] font-extrabold uppercase text-[#5B6A99]">
                            Tap #{item.id.toString()}
                          </span>
                          <h4 className="text-[16px] font-bold text-[#0B1B4D] group-hover:text-[#1946D6] transition-colors">
                            {item.name}
                          </h4>
                          <p className="text-[12px] text-[#5B6A99] mt-0.5">
                            {formatDraw(item.tap.perDraw, item.decimals, item.symbol)}
                          </p>
                        </div>

                        <span
                          className={[
                            "px-2.5 py-0.5 rounded-full text-[11px] font-bold",
                            isReady
                              ? "bg-emerald-100 text-emerald-800"
                              : isUsedOnce
                              ? "bg-slate-100 text-slate-700"
                              : "bg-amber-100 text-amber-800",
                          ].join(" ")}
                        >
                          {isReady ? "Ready to Draw" : isUsedOnce ? "Used Once" : "On Cooldown"}
                        </span>
                      </div>
                    </Panel>
                  </Link>
                );
              })
            )}
          </div>
        )}
      </BotChainGate>
    </PageShell>
  );
}

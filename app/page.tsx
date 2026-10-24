"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useChainId, useReadContract } from "wagmi";
import PageShell from "@/components/layout/PageShell";
import TapCard from "@/components/tap/TapCard";
import Panel from "@/components/ui/Panel";
import Button from "@/components/ui/Button";
import { activeBotChain, isBotChainId } from "@/lib/botchain/chain";
import { getDeployment, isDeployed } from "@/lib/botchain/deployment";
import { tapAbi } from "@/lib/botchain/abi";
import type { TapView } from "@/lib/tap";

export default function HomePage() {
  const chainId = useChainId();
  const effectiveChainId = isBotChainId(chainId) ? chainId : activeBotChain.id;
  const deployment = getDeployment(effectiveChainId);
  const contractAddress = deployment.address;
  const deployed = isDeployed(effectiveChainId);

  const [query, setQuery] = useState("");

  const { data: tapsData, isLoading, refetch } = useReadContract({
    address: contractAddress,
    abi: tapAbi,
    functionName: "latest",
    args: [0n, 50n],
    query: {
      enabled: deployed,
    },
  });

  const taps = (tapsData as TapView[] | undefined) ?? [];

  const filteredTaps = useMemo(() => {
    if (!query.trim()) return taps;
    const q = query.toLowerCase().trim();
    return taps.filter((t) => {
      return (
        t.id.toString() === q ||
        t.owner.toLowerCase().includes(q) ||
        t.token.toLowerCase().includes(q)
      );
    });
  }, [taps, query]);

  return (
    <PageShell
      title="Public Faucets"
      description="Draw free tokens or native BOT on BOT Chain. Anyone can create or top up a tap."
    >
      {/* Search Input */}
      <div className="relative mb-2">
        <input
          type="search"
          placeholder="Search by ID, owner, or token address..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full px-4 py-3 rounded-full bg-white/10 text-white placeholder-white/60 border border-white/20 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#FFD23F] focus:bg-white/15"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="absolute right-3.5 top-1/2 -translate-y-1/2 text-white/70 hover:text-white text-[12px] font-bold"
          >
            Clear
          </button>
        )}
      </div>

      {/* Main List */}
      <div className="flex flex-col gap-3">
        {!deployed ? (
          <Panel>
            <div className="text-center py-4">
              <span className="text-[28px] mb-2 block">⛓️</span>
              <h3 className="text-[16px] font-bold text-[#0B1B4D]">Tap Not Deployed</h3>
              <p className="text-[13px] text-[#5B6A99] mt-1">
                Deploy Tap to {activeBotChain.name} to start exploring community faucets.
              </p>
            </div>
          </Panel>
        ) : isLoading ? (
          <Panel>
            <div className="flex items-center justify-center gap-3 py-8">
              <span className="w-5 h-5 border-2 border-[#1946D6] border-t-transparent rounded-full animate-spin" />
              <span className="text-[14px] font-bold text-[#0B1B4D]">Loading faucets...</span>
            </div>
          </Panel>
        ) : filteredTaps.length === 0 ? (
          <Panel>
            <div className="text-center py-6">
              <span className="text-[32px] mb-2 block">💧</span>
              <h3 className="text-[17px] font-bold text-[#0B1B4D]">
                {taps.length === 0 ? "No Faucets Yet" : "No Matching Faucets"}
              </h3>
              <p className="text-[13px] text-[#5B6A99] mt-1 mb-4">
                {taps.length === 0
                  ? "Be the first to create a faucet for your community or token."
                  : "Try searching with a different ID or address."}
              </p>
              {taps.length === 0 && (
                <Link href="/new" className="no-underline inline-block">
                  <Button variant="primary" size="md">
                    Create a Tap
                  </Button>
                </Link>
              )}
            </div>
          </Panel>
        ) : (
          filteredTaps.map((tap) => (
            <TapCard
              key={tap.id.toString()}
              tap={tap}
              contractAddress={contractAddress}
            />
          ))
        )}
      </div>
    </PageShell>
  );
}

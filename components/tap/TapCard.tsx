"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { formatUnits, zeroAddress, type Address } from "viem";
import { usePublicClient } from "wagmi";
import Panel from "@/components/ui/Panel";
import { describeCooldown, drawsLeft, formatDraw, loadTapName, tokenMeta, type TapView } from "@/lib/tap";
import { shortAddress } from "@/lib/errors";

interface TapCardProps {
  tap: TapView;
  contractAddress: Address;
}

export default function TapCard({ tap, contractAddress }: TapCardProps) {
  const publicClient = usePublicClient();
  const publicClientRef = useRef(publicClient);
  publicClientRef.current = publicClient;

  const [name, setName] = useState<string>(`Tap #${tap.id}`);
  const [meta, setMeta] = useState<{ symbol: string; decimals: number }>({
    symbol: tap.token === zeroAddress ? "BOT" : "TOKEN",
    decimals: 18,
  });

  useEffect(() => {
    if (!publicClientRef.current) return;

    // Load tap name from log
    loadTapName(publicClientRef.current, contractAddress, tap.id, tap.createdBlock).then(setName);

    // Load token meta
    tokenMeta(publicClientRef.current, tap.token).then(setMeta);
  }, [contractAddress, tap.id, tap.createdBlock, tap.token]);

  const left = drawsLeft(tap.balance, tap.perDraw);
  const isDry = tap.balance < tap.perDraw;

  return (
    <Link href={`/t/${tap.id}`} className="no-underline block group">
      <Panel className="hover:border-[#9CB7F5] transition-all group-hover:shadow-[0_12px_28px_rgba(11,27,77,0.12)]">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[18px]">💧</span>
              <h2 className="text-[17px] font-extrabold tracking-tight text-[#0B1B4D] group-hover:text-[#1946D6] transition-colors">
                {name}
              </h2>
            </div>
            <p className="text-[12px] text-[#5B6A99] mt-0.5 font-medium">
              By {shortAddress(tap.owner)}
            </p>
          </div>

          <div className="text-right">
            <span
              className={[
                "inline-block px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider",
                isDry
                  ? "bg-red-100 text-red-700"
                  : "bg-emerald-100 text-emerald-800",
              ].join(" ")}
            >
              {isDry ? "Dry" : `${left.toString()} draws left`}
            </span>
          </div>
        </div>

        {/* Level bar */}
        <div className="w-full bg-[#EAEFFA] h-2 rounded-full overflow-hidden my-3">
          <div
            className={[
              "h-full rounded-full transition-all duration-500",
              isDry ? "bg-red-400" : "bg-[#1946D6]",
            ].join(" ")}
            style={{
              width: isDry
                ? "0%"
                : `${Math.min(100, Math.max(5, Number(left > 100n ? 100n : left)))}%`,
            }}
          />
        </div>

        <div className="flex items-center justify-between text-[12px] pt-1 border-t border-[#E3E9FB]">
          <span className="font-bold text-[#0B1B4D]">
            {formatDraw(tap.perDraw, meta.decimals, meta.symbol)} / draw
          </span>
          <span className="text-[#5B6A99] font-medium">
            Cooldown: {describeCooldown(tap.cooldown)}
          </span>
        </div>
      </Panel>
    </Link>
  );
}

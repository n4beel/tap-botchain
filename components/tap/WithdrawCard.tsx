"use client";

import { useEffect, useRef, useState } from "react";
import { formatUnits, parseUnits, type Address, type Hex } from "viem";
import { useAccount, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import Panel from "@/components/ui/Panel";
import Button from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { tapAbi } from "@/lib/botchain/abi";
import { describeError } from "@/lib/errors";
import type { TapView } from "@/lib/tap";

interface WithdrawCardProps {
  tap: TapView;
  contractAddress: Address;
  symbol: string;
  decimals: number;
  onWithdrawn: () => void;
}

export default function WithdrawCard({
  tap,
  contractAddress,
  symbol,
  decimals,
  onWithdrawn,
}: WithdrawCardProps) {
  const { address } = useAccount();
  const { toast } = useToast();

  const isOwner = address && address.toLowerCase() === tap.owner.toLowerCase();
  const [amountStr, setAmountStr] = useState<string>("");

  const settledHash = useRef<Hex | null>(null);
  const { data: hash, isPending, writeContract } = useWriteContract();
  const { isSuccess, isError, error } = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    if (!hash || hash === settledHash.current) return;

    if (isSuccess) {
      settledHash.current = hash;
      toast("success", "Withdrawal confirmed!");
      setAmountStr("");
      onWithdrawn();
    } else if (isError) {
      settledHash.current = hash;
      toast("error", describeError(error));
    }
  }, [hash, isSuccess, isError, error, toast, onWithdrawn]);

  if (!isOwner) return null;

  const maxFormatted = formatUnits(tap.balance, decimals);

  const handleMax = () => {
    setAmountStr(maxFormatted);
  };

  const parsedAmount = (() => {
    try {
      if (!amountStr || parseFloat(amountStr) <= 0) return 0n;
      return parseUnits(amountStr, decimals);
    } catch {
      return 0n;
    }
  })();

  const handleWithdraw = () => {
    if (parsedAmount <= 0n || parsedAmount > tap.balance) return;
    try {
      writeContract({
        address: contractAddress,
        abi: tapAbi,
        functionName: "withdraw",
        args: [tap.id, parsedAmount],
      });
    } catch (err) {
      toast("error", describeError(err));
    }
  };

  return (
    <Panel className="border-amber-200 bg-amber-50/50">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-[17px] font-extrabold text-[#0B1B4D]">Owner Controls</h3>
        <span className="text-[11px] font-bold uppercase tracking-wider bg-amber-200/80 text-amber-900 px-2 py-0.5 rounded-full">
          Creator
        </span>
      </div>
      <p className="text-[13px] text-[#5B6A99] mb-4">
        As the creator, you can withdraw remaining balance from this tap at any time.
      </p>

      <div className="flex flex-col gap-3">
        <div>
          <div className="flex items-center justify-between text-[11px] font-bold text-[#0B1B4D] mb-1">
            <span className="uppercase tracking-wider">Amount to Withdraw</span>
            <span className="text-[#5B6A99]">
              Available: {maxFormatted} {symbol}
            </span>
          </div>
          <div className="relative">
            <input
              type="text"
              inputMode="decimal"
              placeholder="0.0"
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              className="w-full px-4 py-2.5 rounded-2xl border border-[#CBD8F7] bg-white text-[#0B1B4D] font-mono text-[14px] focus:outline-none focus:border-[#1946D6]"
            />
            <button
              type="button"
              onClick={handleMax}
              className="absolute right-3 top-1/2 -translate-y-1/2 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider bg-[#F4F7FE] text-[#1946D6] rounded-md hover:bg-[#EAEFFA]"
            >
              Max
            </button>
          </div>
        </div>

        <Button
          type="button"
          variant="secondary"
          loading={isPending}
          disabled={parsedAmount <= 0n || parsedAmount > tap.balance}
          onClick={handleWithdraw}
          className="w-full"
        >
          Withdraw {amountStr || "0"} {symbol}
        </Button>
      </div>
    </Panel>
  );
}

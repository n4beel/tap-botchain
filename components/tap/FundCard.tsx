"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatUnits, parseEther, parseUnits, zeroAddress, type Address, type Hex } from "viem";
import { useAccount, useChainId, usePublicClient, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import Panel from "@/components/ui/Panel";
import Button from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { tapAbi } from "@/lib/botchain/abi";
import { erc20Abi } from "@/lib/erc20";
import { describeError } from "@/lib/errors";
import type { TapView } from "@/lib/tap";

interface FundCardProps {
  tap: TapView;
  contractAddress: Address;
  symbol: string;
  decimals: number;
  onFunded: () => void;
}

export default function FundCard({
  tap,
  contractAddress,
  symbol,
  decimals,
  onFunded,
}: FundCardProps) {
  const { address } = useAccount();
  const { toast } = useToast();
  const publicClient = usePublicClient();
  const publicClientRef = useRef(publicClient);
  publicClientRef.current = publicClient;

  const isNative = tap.token === zeroAddress;

  const [amountStr, setAmountStr] = useState<string>("");
  const [allowance, setAllowance] = useState<bigint>(0n);
  const [checkingAllowance, setCheckingAllowance] = useState<boolean>(false);

  const settledHash = useRef<Hex | null>(null);
  const { data: hash, isPending, writeContract } = useWriteContract();
  const { isSuccess, isError, error } = useWaitForTransactionReceipt({ hash });

  const fetchAllowance = useCallback(async () => {
    if (isNative || !address || !publicClientRef.current) return;
    try {
      setCheckingAllowance(true);
      const allowed = (await publicClientRef.current.readContract({
        address: tap.token,
        abi: erc20Abi,
        functionName: "allowance",
        args: [address, contractAddress],
      })) as bigint;
      setAllowance(allowed);
    } catch {
      // Ignored
    } finally {
      setCheckingAllowance(false);
    }
  }, [isNative, address, tap.token, contractAddress]);

  useEffect(() => {
    fetchAllowance();
  }, [fetchAllowance]);

  useEffect(() => {
    if (!hash || hash === settledHash.current) return;

    if (isSuccess) {
      settledHash.current = hash;
      toast("success", "Tap funded successfully!");
      setAmountStr("");
      fetchAllowance();
      onFunded();
    } else if (isError) {
      settledHash.current = hash;
      toast("error", describeError(error));
    }
  }, [hash, isSuccess, isError, error, toast, fetchAllowance, onFunded]);

  const parsedAmount = (() => {
    try {
      if (!amountStr || parseFloat(amountStr) <= 0) return 0n;
      return isNative ? parseEther(amountStr) : parseUnits(amountStr, decimals);
    } catch {
      return 0n;
    }
  })();

  const needsApproval = !isNative && parsedAmount > 0n && allowance < parsedAmount;

  const handleApprove = () => {
    if (parsedAmount <= 0n) return;
    try {
      writeContract({
        address: tap.token,
        abi: erc20Abi,
        functionName: "approve",
        args: [contractAddress, parsedAmount],
      });
    } catch (err) {
      toast("error", describeError(err));
    }
  };

  const handleFund = () => {
    if (parsedAmount <= 0n) return;
    try {
      if (isNative) {
        writeContract({
          address: contractAddress,
          abi: tapAbi,
          functionName: "fundNative",
          args: [tap.id],
          value: parsedAmount,
        });
      } else {
        writeContract({
          address: contractAddress,
          abi: tapAbi,
          functionName: "fundToken",
          args: [tap.id, parsedAmount],
        });
      }
    } catch (err) {
      toast("error", describeError(err));
    }
  };

  return (
    <Panel>
      <h3 className="text-[17px] font-extrabold text-[#0B1B4D] mb-1">Top Up This Tap</h3>
      <p className="text-[13px] text-[#5B6A99] mb-4">
        Anyone can add funds to keep this faucet flowing for the community.
      </p>

      <div className="flex flex-col gap-3">
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wider text-[#0B1B4D] mb-1">
            Amount ({symbol})
          </label>
          <div className="relative">
            <input
              type="text"
              inputMode="decimal"
              placeholder="0.0"
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              className="w-full px-4 py-2.5 rounded-2xl border border-[#CBD8F7] bg-[#F4F7FE] text-[#0B1B4D] font-mono text-[14px] focus:outline-none focus:border-[#1946D6]"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[12px] font-bold text-[#5B6A99]">
              {symbol}
            </span>
          </div>
        </div>

        {!address ? (
          <p className="text-[12px] text-amber-600 font-medium text-center py-2">
            Connect wallet to top up this tap.
          </p>
        ) : needsApproval ? (
          <Button
            type="button"
            variant="primary"
            loading={isPending}
            disabled={parsedAmount <= 0n}
            onClick={handleApprove}
            className="w-full"
          >
            Approve {amountStr} {symbol}
          </Button>
        ) : (
          <Button
            type="button"
            variant="primary"
            loading={isPending}
            disabled={parsedAmount <= 0n}
            onClick={handleFund}
            className="w-full"
          >
            Fill Tap with {amountStr || "0"} {symbol}
          </Button>
        )}
      </div>
    </Panel>
  );
}

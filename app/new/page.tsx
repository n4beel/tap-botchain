"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  decodeEventLog,
  isAddress,
  parseEther,
  parseUnits,
  zeroAddress,
  type Address,
} from "viem";
import {
  useAccount,
  useChainId,
  usePublicClient,
  useWriteContract,
} from "wagmi";
import PageShell from "@/components/layout/PageShell";
import BotChainGate from "@/components/botchain/BotChainGate";
import Panel from "@/components/ui/Panel";
import Button from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { activeBotChain, isBotChainId } from "@/lib/botchain/chain";
import { getDeployment } from "@/lib/botchain/deployment";
import { tapAbi } from "@/lib/botchain/abi";
import { erc20Abi } from "@/lib/erc20";
import { describeError } from "@/lib/errors";
import { byteLength, tokenMeta } from "@/lib/tap";
import { COOLDOWN_PRESETS, MAX_NAME_BYTES, ONCE } from "@/lib/limits";
import {
  planTapFundingSteps,
  savePendingFunding,
  getPendingFunding,
  clearPendingFunding,
  type TapFundingStep,
  type PendingFunding,
} from "@/lib/tap-funding";

export default function NewTapPage() {
  const { address } = useAccount();
  const chainId = useChainId();
  const effectiveChainId = isBotChainId(chainId) ? chainId : activeBotChain.id;
  const deployment = getDeployment(effectiveChainId);
  const contractAddress = deployment.address;
  const { toast } = useToast();

  const publicClient = usePublicClient();
  const publicClientRef = useRef(publicClient);
  publicClientRef.current = publicClient;

  // Wizard Stage: 1 = Asset, 2 = Terms, 3 = Fund & Launch
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Asset Form State
  const [assetType, setAssetType] = useState<"native" | "token">("native");
  const [tokenAddressInput, setTokenAddressInput] = useState<string>("");
  const [tokenInfo, setTokenInfo] = useState<{ symbol: string; decimals: number; name: string }>({
    symbol: "BOT",
    decimals: 18,
    name: "Native BOT",
  });
  const [tokenValidating, setTokenValidating] = useState<boolean>(false);
  const [tokenError, setTokenError] = useState<string>("");

  // Terms Form State
  const [nameInput, setNameInput] = useState<string>("");
  const [perDrawInput, setPerDrawInput] = useState<string>("0.01");
  const [cooldownVal, setCooldownVal] = useState<bigint>(3600n);

  // Initial Funding State (empty string = unfunded by default)
  const [initialFundInput, setInitialFundInput] = useState<string>("");
  const [allowance, setAllowance] = useState<bigint>(0n);

  // Stepper execution state
  const [flowRunning, setFlowRunning] = useState<boolean>(false);
  const [currentExecutingStep, setCurrentExecutingStep] = useState<TapFundingStep | null>(null);
  const [executedSteps, setExecutedSteps] = useState<Set<TapFundingStep>>(new Set());
  const [failedStep, setFailedStep] = useState<TapFundingStep | null>(null);
  const [stepError, setStepError] = useState<string>("");
  const [createdTapId, setCreatedTapId] = useState<bigint | null>(null);

  // Interrupted pending funding from previous session
  const [pendingInterruption, setPendingInterruption] = useState<PendingFunding | null>(null);

  const { writeContractAsync } = useWriteContract();

  // Check for interrupted funding on mount
  useEffect(() => {
    const pending = getPendingFunding();
    if (pending) {
      setPendingInterruption(pending);
    }
  }, []);

  // Validate Token Address
  const validateToken = useCallback(async (addr: string) => {
    setTokenError("");
    if (!isAddress(addr)) {
      setTokenError("Invalid Ethereum address.");
      return;
    }
    if (!publicClientRef.current) return;

    try {
      setTokenValidating(true);
      const code = await publicClientRef.current.getBytecode({ address: addr as Address });
      if (!code || code === "0x") {
        setTokenError("This address is not a deployed contract.");
        return;
      }

      const meta = await tokenMeta(publicClientRef.current, addr as Address);
      setTokenInfo(meta);
    } catch {
      setTokenError("Could not read ERC-20 metadata from this contract.");
    } finally {
      setTokenValidating(false);
    }
  }, []);

  // Handle Token Address Input Change
  const handleTokenChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.trim();
    setTokenAddressInput(val);
    if (isAddress(val)) {
      validateToken(val);
    } else {
      setTokenError(val ? "Invalid address format." : "");
    }
  };

  // Check allowance when entering stage 3 or changing initial fund
  useEffect(() => {
    if (assetType !== "token" || !address || !publicClientRef.current || !isAddress(tokenAddressInput)) return;
    publicClientRef.current.readContract({
      address: tokenAddressInput as Address,
      abi: erc20Abi,
      functionName: "allowance",
      args: [address, contractAddress],
    }).then((allowed) => {
      setAllowance(allowed as bigint);
    }).catch(() => {
      setAllowance(0n);
    });
  }, [assetType, address, tokenAddressInput, contractAddress, step]);

  // Compute parsed funding amount
  const parsedFundAmount = (() => {
    try {
      const trimmed = initialFundInput.trim();
      if (!trimmed || parseFloat(trimmed) <= 0) return 0n;
      return assetType === "native" ? parseEther(trimmed) : parseUnits(trimmed, tokenInfo.decimals);
    } catch {
      return 0n;
    }
  })();

  // Compute planned steps
  const plannedSteps = planTapFundingSteps({
    assetType,
    initialFund: parsedFundAmount,
    allowance,
  });

  // Form Validations
  const nameBytes = byteLength(nameInput);
  const isNameValid = nameInput.trim().length > 0 && nameBytes <= MAX_NAME_BYTES;
  const isPerDrawValid = parseFloat(perDrawInput) > 0;

  // Run sequential wizard flow
  const handleRunFlow = async (resumeTapId?: bigint) => {
    if (!address) {
      toast("error", "Wallet not connected.");
      return;
    }
    if (!publicClientRef.current) {
      toast("error", "Network client not ready.");
      return;
    }

    setFlowRunning(true);
    setFailedStep(null);
    setStepError("");

    let currentTapId = resumeTapId ?? createdTapId;

    try {
      // Step 1: Approve (if planned and not already done)
      if (plannedSteps.includes("approve") && !executedSteps.has("approve")) {
        setCurrentExecutingStep("approve");
        const approveHash = await writeContractAsync({
          address: tokenAddressInput as Address,
          abi: erc20Abi,
          functionName: "approve",
          args: [contractAddress, parsedFundAmount],
        });
        await publicClientRef.current.waitForTransactionReceipt({ hash: approveHash });
        setExecutedSteps((prev) => new Set([...prev, "approve"]));
      }

      // Step 2: Create (if not already created)
      if (!currentTapId) {
        setCurrentExecutingStep("create");
        const tokenAddr = assetType === "native" ? zeroAddress : (tokenAddressInput as Address);
        const perDraw = assetType === "native"
          ? parseEther(perDrawInput)
          : parseUnits(perDrawInput, tokenInfo.decimals);

        const createHash = await writeContractAsync({
          address: contractAddress,
          abi: tapAbi,
          functionName: "create",
          args: [tokenAddr, perDraw, cooldownVal, nameInput.trim()],
          value: assetType === "native" ? parsedFundAmount : 0n,
        });

        const receipt = await publicClientRef.current.waitForTransactionReceipt({ hash: createHash });
        for (const log of receipt.logs) {
          try {
            const decoded = decodeEventLog({
              abi: tapAbi,
              data: log.data,
              topics: log.topics,
            });
            if (decoded.eventName === "TapCreated") {
              currentTapId = (decoded.args as { id: bigint }).id;
              setCreatedTapId(currentTapId);
              break;
            }
          } catch {
            // scan next
          }
        }
        setExecutedSteps((prev) => new Set([...prev, "create"]));
      }

      // Step 3: Fund Token (if planned and not already done)
      if (plannedSteps.includes("fundToken") && currentTapId && !executedSteps.has("fundToken")) {
        // Save pending funding for interruption recovery
        savePendingFunding({
          tapId: currentTapId.toString(),
          tokenAddress: tokenAddressInput,
          tokenSymbol: tokenInfo.symbol,
          tokenDecimals: tokenInfo.decimals,
          amountStr: initialFundInput.trim(),
          step: "fundToken",
        });

        setCurrentExecutingStep("fundToken");
        const fundHash = await writeContractAsync({
          address: contractAddress,
          abi: tapAbi,
          functionName: "fundToken",
          args: [currentTapId, parsedFundAmount],
        });
        await publicClientRef.current.waitForTransactionReceipt({ hash: fundHash });
        setExecutedSteps((prev) => new Set([...prev, "fundToken"]));
        clearPendingFunding(currentTapId.toString());
      }

      setCurrentExecutingStep(null);
      setFlowRunning(false);
      setPendingInterruption(null);
      toast("success", "Tap created and funded successfully!");
    } catch (err) {
      setFlowRunning(false);
      const desc = describeError(err);
      setStepError(desc);
      setFailedStep(currentExecutingStep ?? "create");
      toast("error", desc);
    }
  };

  // Resume interrupted funding from banner
  const handleResumeFunding = async (interrupted: PendingFunding) => {
    if (!address || !publicClientRef.current) return;
    try {
      setFlowRunning(true);
      setCurrentExecutingStep("fundToken");
      setFailedStep(null);
      setStepError("");

      const amountWei = parseUnits(interrupted.amountStr, interrupted.tokenDecimals);
      const tapId = BigInt(interrupted.tapId);

      const fundHash = await writeContractAsync({
        address: contractAddress,
        abi: tapAbi,
        functionName: "fundToken",
        args: [tapId, amountWei],
      });
      await publicClientRef.current.waitForTransactionReceipt({ hash: fundHash });
      clearPendingFunding(interrupted.tapId);
      setPendingInterruption(null);
      setFlowRunning(false);
      setCurrentExecutingStep(null);
      setCreatedTapId(tapId);
      toast("success", `Tap #${interrupted.tapId} funding completed!`);
    } catch (err) {
      setFlowRunning(false);
      const desc = describeError(err);
      setStepError(desc);
      setFailedStep("fundToken");
      toast("error", desc);
    }
  };

  return (
    <PageShell
      title="Create a Tap"
      description="Launch a public faucet for your community. Choose your asset, draw amounts, and cooldown rules in a single flow."
    >
      <BotChainGate noWalletNote="Creating a new faucet requires a connected wallet to sign the setup transaction.">
        {/* Interruption recovery notice */}
        {pendingInterruption && !createdTapId && (
          <div className="mb-4 p-4 rounded-2xl bg-amber-50 border border-amber-300 text-[13px] text-amber-900 flex flex-col gap-2">
            <div className="flex items-center gap-2 font-bold">
              <span>⚠️</span>
              <span>Interrupted Tap Funding Detected</span>
            </div>
            <p>
              Tap #{pendingInterruption.tapId} was created, but initial funding of {pendingInterruption.amountStr} {pendingInterruption.tokenSymbol} was not completed.
            </p>
            <div className="flex items-center gap-2 pt-1">
              <Button
                size="sm"
                variant="primary"
                loading={flowRunning}
                onClick={() => handleResumeFunding(pendingInterruption)}
              >
                Finish Funding Tap #{pendingInterruption.tapId}
              </Button>
              <button
                type="button"
                className="text-[12px] text-amber-800 underline hover:no-underline ml-2"
                onClick={() => {
                  clearPendingFunding(pendingInterruption.tapId);
                  setPendingInterruption(null);
                }}
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {createdTapId !== null && !flowRunning && !failedStep ? (
          <Panel className="text-center py-8">
            <span className="text-[40px] block mb-2">🎉</span>
            <h2 className="text-[20px] font-extrabold text-[#0B1B4D] mb-1">
              Tap #{createdTapId.toString()} is Live!
            </h2>
            <p className="text-[13px] text-[#5B6A99] mb-6 max-w-[340px] mx-auto">
              Your faucet is created and ready for the community. Anyone can now draw according to your terms.
            </p>
            <div className="flex flex-col gap-2 max-w-[280px] mx-auto">
              <Link href={`/t/${createdTapId.toString()}`} className="no-underline">
                <Button variant="primary" className="w-full">
                  Go to Tap #{createdTapId.toString()}
                </Button>
              </Link>
              <Link href="/mine" className="no-underline">
                <Button variant="secondary" className="w-full">
                  View My Taps
                </Button>
              </Link>
            </div>
          </Panel>
        ) : (
          <Panel>
            {/* Step Indicators */}
            <div className="flex items-center justify-between pb-4 mb-6 border-b border-[#E3E9FB]">
              <div className="flex items-center gap-2">
                <span
                  className={[
                    "w-6 h-6 rounded-full flex items-center justify-center text-[12px] font-bold",
                    step === 1 ? "bg-[#1946D6] text-white" : "bg-[#EAEFFA] text-[#0B1B4D]",
                  ].join(" ")}
                >
                  1
                </span>
                <span className="text-[13px] font-bold text-[#0B1B4D]">Asset</span>
              </div>
              <span className="text-[#CBD8F7]">───</span>
              <div className="flex items-center gap-2">
                <span
                  className={[
                    "w-6 h-6 rounded-full flex items-center justify-center text-[12px] font-bold",
                    step === 2 ? "bg-[#1946D6] text-white" : "bg-[#EAEFFA] text-[#0B1B4D]",
                  ].join(" ")}
                >
                  2
                </span>
                <span className="text-[13px] font-bold text-[#0B1B4D]">Terms</span>
              </div>
              <span className="text-[#CBD8F7]">───</span>
              <div className="flex items-center gap-2">
                <span
                  className={[
                    "w-6 h-6 rounded-full flex items-center justify-center text-[12px] font-bold",
                    step === 3 ? "bg-[#1946D6] text-white" : "bg-[#EAEFFA] text-[#0B1B4D]",
                  ].join(" ")}
                >
                  3
                </span>
                <span className="text-[13px] font-bold text-[#0B1B4D]">Launch & Fund</span>
              </div>
            </div>

            {/* Stage 1: Asset Selection */}
            {step === 1 && (
              <div className="flex flex-col gap-4">
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-[#0B1B4D] mb-2">
                    Select Currency
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setAssetType("native");
                        setTokenInfo({ symbol: "BOT", decimals: 18, name: "Native BOT" });
                      }}
                      className={[
                        "p-4 rounded-2xl border text-left flex flex-col justify-between transition-all min-h-[72px]",
                        assetType === "native"
                          ? "border-[#1946D6] bg-[#F4F7FE] ring-2 ring-[#1946D6]/20"
                          : "border-[#CBD8F7] bg-white hover:border-[#9CB7F5]",
                      ].join(" ")}
                    >
                      <span className="text-[20px]">🪙</span>
                      <span className="font-extrabold text-[15px] text-[#0B1B4D] mt-2">
                        Native BOT
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setAssetType("token")}
                      className={[
                        "p-4 rounded-2xl border text-left flex flex-col justify-between transition-all min-h-[72px]",
                        assetType === "token"
                          ? "border-[#1946D6] bg-[#F4F7FE] ring-2 ring-[#1946D6]/20"
                          : "border-[#CBD8F7] bg-white hover:border-[#9CB7F5]",
                      ].join(" ")}
                    >
                      <span className="text-[20px]">📜</span>
                      <span className="font-extrabold text-[15px] text-[#0B1B4D] mt-2">
                        ERC-20 Token
                      </span>
                    </button>
                  </div>
                </div>

                {assetType === "token" && (
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-[#0B1B4D] mb-1">
                      Token Contract Address
                    </label>
                    <input
                      type="text"
                      placeholder="0x..."
                      value={tokenAddressInput}
                      onChange={handleTokenChange}
                      className="w-full px-4 py-2.5 rounded-2xl border border-[#CBD8F7] bg-[#F4F7FE] text-[#0B1B4D] font-mono text-[13px] focus:outline-none focus:border-[#1946D6]"
                    />
                    {tokenValidating && (
                      <p className="text-[12px] text-[#1946D6] mt-1">Checking token bytecode...</p>
                    )}
                    {tokenError && (
                      <p className="text-[12px] text-red-600 font-medium mt-1">{tokenError}</p>
                    )}
                    {isAddress(tokenAddressInput) && !tokenError && !tokenValidating && (
                      <div className="mt-2 p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between text-[12px]">
                        <span className="text-emerald-900 font-bold">
                          ✓ {tokenInfo.name} ({tokenInfo.symbol})
                        </span>
                        <span className="text-emerald-700">Decimals: {tokenInfo.decimals}</span>
                      </div>
                    )}
                  </div>
                )}

                <Button
                  type="button"
                  variant="primary"
                  className="w-full mt-2"
                  disabled={assetType === "token" && (!isAddress(tokenAddressInput) || Boolean(tokenError))}
                  onClick={() => setStep(2)}
                >
                  Continue to Terms →
                </Button>
              </div>
            )}

            {/* Stage 2: Terms */}
            {step === 2 && (
              <div className="flex flex-col gap-4">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-[#0B1B4D]">
                      Tap Name
                    </label>
                    <span className="text-[11px] text-[#5B6A99]">
                      {nameBytes} / {MAX_NAME_BYTES} bytes
                    </span>
                  </div>
                  <input
                    type="text"
                    placeholder="e.g. Community Developer Faucet"
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-2xl border border-[#CBD8F7] bg-[#F4F7FE] text-[#0B1B4D] text-[14px] focus:outline-none focus:border-[#1946D6]"
                  />
                  {nameBytes > MAX_NAME_BYTES && (
                    <p className="text-[12px] text-red-600 font-medium mt-1">
                      Name exceeds maximum 40 bytes.
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-[#0B1B4D] mb-1">
                    Amount Distributed Per Draw
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={perDrawInput}
                      onChange={(e) => setPerDrawInput(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-2xl border border-[#CBD8F7] bg-[#F4F7FE] text-[#0B1B4D] font-mono text-[14px] focus:outline-none focus:border-[#1946D6]"
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 font-bold text-[12px] text-[#5B6A99]">
                      {tokenInfo.symbol}
                    </span>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-[#0B1B4D] mb-2">
                    Cooldown Interval
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {COOLDOWN_PRESETS.map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => setCooldownVal(preset.value)}
                        className={[
                          "px-3 py-2 rounded-xl border text-[13px] font-bold transition-all text-left",
                          cooldownVal === preset.value
                            ? "border-[#1946D6] bg-[#1946D6] text-white"
                            : "border-[#CBD8F7] bg-[#F4F7FE] text-[#0B1B4D] hover:border-[#9CB7F5]",
                        ].join(" ")}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setStep(1)}
                    className="flex-1"
                  >
                    ← Back
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    disabled={!isNameValid || !isPerDrawValid}
                    onClick={() => setStep(3)}
                    className="flex-1"
                  >
                    Continue →
                  </Button>
                </div>
              </div>
            )}

            {/* Stage 3: Initial Funding & Launch in One Flow */}
            {step === 3 && (
              <div className="flex flex-col gap-4">
                <div className="bg-[#F4F7FE] p-4 rounded-2xl border border-[#CBD8F7] text-[13px] flex flex-col gap-2">
                  <div className="flex justify-between">
                    <span className="text-[#5B6A99]">Tap Name:</span>
                    <span className="font-bold text-[#0B1B4D]">{nameInput}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#5B6A99]">Per Draw:</span>
                    <span className="font-bold text-[#0B1B4D]">
                      {perDrawInput} {tokenInfo.symbol}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#5B6A99]">Cooldown:</span>
                    <span className="font-bold text-[#0B1B4D]">
                      {cooldownVal === ONCE ? "Once ever" : `${cooldownVal.toString()}s`}
                    </span>
                  </div>
                </div>

                {/* Initial Funding Input for both BOT and tokens */}
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-[#0B1B4D] mb-1">
                    Initial Funding (Optional)
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={initialFundInput}
                      onChange={(e) => setInitialFundInput(e.target.value)}
                      placeholder="0.0 (default unfunded)"
                      disabled={flowRunning}
                      className="w-full px-4 py-2.5 rounded-2xl border border-[#CBD8F7] bg-[#F4F7FE] text-[#0B1B4D] font-mono text-[14px] focus:outline-none focus:border-[#1946D6]"
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 font-bold text-[12px] text-[#5B6A99]">
                      {tokenInfo.symbol}
                    </span>
                  </div>
                  <p className="text-[11px] text-[#5B6A99] mt-1">
                    {parsedFundAmount > 0n
                      ? `Will create and fund with ${initialFundInput.trim()} ${tokenInfo.symbol} in one automated flow.`
                      : "Leave empty to create an unfunded tap (funds can be added anytime later)."}
                  </p>
                </div>

                {/* Visible Stepper Overview */}
                <div className="bg-[#F8FAFF] p-4 rounded-2xl border border-[#CBD8F7]">
                  <div className="text-[12px] font-bold uppercase tracking-wider text-[#0B1B4D] mb-3">
                    Execution Steps ({plannedSteps.length})
                  </div>
                  <div className="flex flex-col gap-2.5">
                    {plannedSteps.map((st, idx) => {
                      const isExecuted = executedSteps.has(st);
                      const isExecuting = flowRunning && currentExecutingStep === st;
                      const isFailed = failedStep === st;

                      let label = "";
                      if (st === "approve") {
                        label = `1. Approve ${tokenInfo.symbol} Transfer`;
                      } else if (st === "create") {
                        label = `${idx + 1}. Create Faucet Contract${assetType === "native" && parsedFundAmount > 0n ? ` (with ${initialFundInput.trim()} BOT)` : ""}`;
                      } else if (st === "fundToken") {
                        label = `${idx + 1}. Deposit Initial ${initialFundInput.trim()} ${tokenInfo.symbol}`;
                      }

                      return (
                        <div
                          key={st}
                          className={[
                            "p-2.5 rounded-xl border flex items-center justify-between text-[13px] transition-all",
                            isExecuting
                              ? "border-[#1946D6] bg-blue-50/50 text-[#1946D6] font-bold"
                              : isExecuted
                                ? "border-emerald-300 bg-emerald-50 text-emerald-900 font-semibold"
                                : isFailed
                                  ? "border-red-300 bg-red-50 text-red-900 font-semibold"
                                  : "border-gray-200 bg-white text-gray-600",
                          ].join(" ")}
                        >
                          <div className="flex items-center gap-2">
                            <span>
                              {isExecuted ? "✓" : isExecuting ? "⏳" : isFailed ? "✕" : "○"}
                            </span>
                            <span>{label}</span>
                          </div>
                          <span className="text-[11px] uppercase tracking-wider">
                            {isExecuted
                              ? "Done"
                              : isExecuting
                                ? "Signing..."
                                : isFailed
                                  ? "Failed"
                                  : "Pending"}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {stepError && (
                    <div className="mt-3 p-3 rounded-xl bg-red-50 border border-red-200 text-[12px] text-red-800">
                      <span className="font-bold">Error at step &apos;{failedStep}&apos;: </span>
                      <span>{stepError}</span>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={flowRunning}
                    onClick={() => setStep(2)}
                    className="flex-1"
                  >
                    ← Back
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    loading={flowRunning}
                    onClick={() => handleRunFlow()}
                    className="flex-1"
                  >
                    {failedStep ? "Retry Failed Step" : flowRunning ? "Processing..." : "Create & Fund"}
                  </Button>
                </div>
              </div>
            )}
          </Panel>
        )}
      </BotChainGate>
    </PageShell>
  );
}

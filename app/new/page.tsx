"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  decodeEventLog,
  isAddress,
  parseEther,
  parseUnits,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import {
  useAccount,
  useChainId,
  usePublicClient,
  useWaitForTransactionReceipt,
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

export default function NewTapPage() {
  const router = useRouter();
  const { address } = useAccount();
  const chainId = useChainId();
  const effectiveChainId = isBotChainId(chainId) ? chainId : activeBotChain.id;
  const deployment = getDeployment(effectiveChainId);
  const contractAddress = deployment.address;
  const { toast } = useToast();

  const publicClient = usePublicClient();
  const publicClientRef = useRef(publicClient);
  publicClientRef.current = publicClient;

  // Wizard Stage: 1 = Asset, 2 = Terms, 3 = Fund
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

  // Fund Form State
  const [initialFundInput, setInitialFundInput] = useState<string>("0.1");

  // Created Tap ID
  const [createdTapId, setCreatedTapId] = useState<bigint | null>(null);

  // Transaction Write Hooks
  const settledCreateRef = useRef<Hex | null>(null);
  const { data: createHash, isPending: isCreatePending, writeContract: writeCreate } = useWriteContract();
  const {
    data: createReceipt,
    isSuccess: isCreateSuccess,
    isError: isCreateError,
    error: createTxError,
  } = useWaitForTransactionReceipt({ hash: createHash });

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

  // Watch create transaction receipt
  useEffect(() => {
    if (!createHash || createHash === settledCreateRef.current) return;

    if (isCreateSuccess && createReceipt) {
      settledCreateRef.current = createHash;
      toast("success", "Tap created successfully on-chain!");

      // Parse TapCreated event to get ID
      for (const log of createReceipt.logs) {
        try {
          const decoded = decodeEventLog({
            abi: tapAbi,
            data: log.data,
            topics: log.topics,
          });
          if (decoded.eventName === "TapCreated") {
            const id = (decoded.args as { id: bigint }).id;
            setCreatedTapId(id);
            break;
          }
        } catch {
          // Continue scanning logs
        }
      }
    } else if (isCreateError) {
      settledCreateRef.current = createHash;
      toast("error", describeError(createTxError));
    }
  }, [createHash, isCreateSuccess, isCreateError, createReceipt, createTxError, toast]);

  // Form Validations
  const nameBytes = byteLength(nameInput);
  const isNameValid = nameInput.trim().length > 0 && nameBytes <= MAX_NAME_BYTES;
  const isPerDrawValid = parseFloat(perDrawInput) > 0;

  const handleCreateTap = () => {
    if (!address) {
      toast("error", "Wallet not connected.");
      return;
    }

    try {
      const tokenAddr = assetType === "native" ? zeroAddress : (tokenAddressInput as Address);
      const perDraw = assetType === "native"
        ? parseEther(perDrawInput)
        : parseUnits(perDrawInput, tokenInfo.decimals);

      const fundValue = assetType === "native" && initialFundInput
        ? parseEther(initialFundInput)
        : 0n;

      writeCreate({
        address: contractAddress,
        abi: tapAbi,
        functionName: "create",
        args: [tokenAddr, perDraw, cooldownVal, nameInput.trim()],
        value: fundValue,
      });
    } catch (err) {
      toast("error", describeError(err));
    }
  };

  return (
    <PageShell
      title="Create a Tap"
      description="Launch a public faucet for your community. Choose your asset, draw amounts, and cooldown rules."
    >
      <BotChainGate noWalletNote="Creating a new faucet requires a connected wallet to sign the setup transaction.">
        {createdTapId !== null ? (
          <Panel className="text-center py-8">
            <span className="text-[40px] block mb-2">🎉</span>
            <h2 className="text-[20px] font-extrabold text-[#0B1B4D] mb-1">
              Tap #{createdTapId.toString()} is Live!
            </h2>
            <p className="text-[13px] text-[#5B6A99] mb-6 max-w-[340px] mx-auto">
              Your faucet is ready for the community. Anyone can now draw according to your terms.
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
                <span className="text-[13px] font-bold text-[#0B1B4D]">Launch</span>
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

            {/* Stage 3: Initial Funding & Launch */}
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

                {assetType === "native" ? (
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-[#0B1B4D] mb-1">
                      Initial Deposit (Optional)
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={initialFundInput}
                        onChange={(e) => setInitialFundInput(e.target.value)}
                        placeholder="0.0"
                        className="w-full px-4 py-2.5 rounded-2xl border border-[#CBD8F7] bg-[#F4F7FE] text-[#0B1B4D] font-mono text-[14px] focus:outline-none focus:border-[#1946D6]"
                      />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 font-bold text-[12px] text-[#5B6A99]">
                        BOT
                      </span>
                    </div>
                    <p className="text-[11px] text-[#5B6A99] mt-1">
                      Funds can also be added anytime after deployment.
                    </p>
                  </div>
                ) : (
                  <p className="text-[12px] text-[#5B6A99] leading-relaxed">
                    Token faucets are created with 0 initial balance. Once created, approve and top up your faucet directly on its page.
                  </p>
                )}

                <div className="flex items-center gap-2 pt-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setStep(2)}
                    className="flex-1"
                  >
                    ← Back
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    loading={isCreatePending}
                    onClick={handleCreateTap}
                    className="flex-1"
                  >
                    Create Faucet
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

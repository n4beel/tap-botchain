/**
 * Tap contract ABI. Hand-written `as const` for strict viem / wagmi typing.
 */
export const tapAbi = [
  {
    type: "function",
    name: "create",
    stateMutability: "payable",
    inputs: [
      { name: "token", type: "address" },
      { name: "perDraw", type: "uint128" },
      { name: "cooldown", type: "uint64" },
      { name: "name", type: "string" },
    ],
    outputs: [{ name: "id", type: "uint256" }],
  },
  {
    type: "function",
    name: "fundNative",
    stateMutability: "payable",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "fundToken",
    stateMutability: "nonpayable",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "amount", type: "uint128" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "draw",
    stateMutability: "nonpayable",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "amount", type: "uint128" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "tapOf",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [
      {
        name: "tap",
        type: "tuple",
        components: [
          { name: "id", type: "uint256" },
          { name: "owner", type: "address" },
          { name: "token", type: "address" },
          { name: "perDraw", type: "uint128" },
          { name: "balance", type: "uint128" },
          { name: "cooldown", type: "uint64" },
          { name: "draws", type: "uint32" },
          { name: "createdBlock", type: "uint64" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "nextDrawAt",
    stateMutability: "view",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "who", type: "address" },
    ],
    outputs: [{ name: "", type: "uint64" }],
  },
  {
    type: "function",
    name: "latest",
    stateMutability: "view",
    inputs: [
      { name: "offset", type: "uint256" },
      { name: "count", type: "uint256" },
    ],
    outputs: [
      {
        name: "items",
        type: "tuple[]",
        components: [
          { name: "id", type: "uint256" },
          { name: "owner", type: "address" },
          { name: "token", type: "address" },
          { name: "perDraw", type: "uint128" },
          { name: "balance", type: "uint128" },
          { name: "cooldown", type: "uint64" },
          { name: "draws", type: "uint32" },
          { name: "createdBlock", type: "uint64" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "tapsBy",
    stateMutability: "view",
    inputs: [{ name: "who", type: "address" }],
    outputs: [{ name: "", type: "uint256[]" }],
  },
  {
    type: "function",
    name: "tapCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "MIN_COOLDOWN",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint64" }],
  },
  {
    type: "function",
    name: "MAX_COOLDOWN",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint64" }],
  },
  {
    type: "function",
    name: "ONCE",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint64" }],
  },
  {
    type: "function",
    name: "MAX_NAME_BYTES",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "MAX_PAGE",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "event",
    name: "TapCreated",
    inputs: [
      { name: "id", type: "uint256", indexed: true },
      { name: "owner", type: "address", indexed: true },
      { name: "token", type: "address", indexed: false },
      { name: "perDraw", type: "uint128", indexed: false },
      { name: "cooldown", type: "uint64", indexed: false },
      { name: "name", type: "string", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Funded",
    inputs: [
      { name: "id", type: "uint256", indexed: true },
      { name: "funder", type: "address", indexed: true },
      { name: "amount", type: "uint128", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Drawn",
    inputs: [
      { name: "id", type: "uint256", indexed: true },
      { name: "drawer", type: "address", indexed: true },
      { name: "amount", type: "uint128", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Withdrawn",
    inputs: [
      { name: "id", type: "uint256", indexed: true },
      { name: "owner", type: "address", indexed: true },
      { name: "amount", type: "uint128", indexed: false },
    ],
  },
  {
    type: "error",
    name: "BadCooldown",
    inputs: [{ name: "cooldown", type: "uint64" }],
  },
  {
    type: "error",
    name: "NameTooLong",
    inputs: [
      { name: "length", type: "uint256" },
      { name: "max", type: "uint256" },
    ],
  },
  {
    type: "error",
    name: "ZeroAmount",
    inputs: [],
  },
  {
    type: "error",
    name: "NotAContract",
    inputs: [{ name: "token", type: "address" }],
  },
  {
    type: "error",
    name: "UnexpectedValue",
    inputs: [],
  },
  {
    type: "error",
    name: "WrongAsset",
    inputs: [{ name: "id", type: "uint256" }],
  },
  {
    type: "error",
    name: "UnsupportedToken",
    inputs: [],
  },
  {
    type: "error",
    name: "NoSuchTap",
    inputs: [{ name: "id", type: "uint256" }],
  },
  {
    type: "error",
    name: "Empty",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "balance", type: "uint256" },
      { name: "perDraw", type: "uint256" },
    ],
  },
  {
    type: "error",
    name: "OnCooldown",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "nextAt", type: "uint64" },
    ],
  },
  {
    type: "error",
    name: "NotOwner",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "caller", type: "address" },
    ],
  },
  {
    type: "error",
    name: "InsufficientBalance",
    inputs: [
      { name: "balance", type: "uint256" },
      { name: "requested", type: "uint256" },
    ],
  },
  {
    type: "error",
    name: "TransferFailed",
    inputs: [],
  },
] as const;

export const contractAbi = tapAbi;

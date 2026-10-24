/**
 * Protocol limits enforced by the Tap smart contract.
 */
export const MIN_COOLDOWN = 60n; // 1 minute
export const MAX_COOLDOWN = 31536000n; // 365 days
export const ONCE = 18446744073709551615n; // type(uint64).max
export const MAX_NAME_BYTES = 40;
export const MAX_PAGE = 50;

export const COOLDOWN_PRESETS = [
  { label: "1 hour", value: 3600n },
  { label: "1 day", value: 86400n },
  { label: "1 week", value: 604800n },
  { label: "Once ever", value: ONCE },
] as const;

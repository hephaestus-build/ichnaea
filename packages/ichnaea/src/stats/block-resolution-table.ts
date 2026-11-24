/** Detectable drop at 80% power for the default horizon, by cases and family size (1–4). */
export const DEFAULT_BLOCK_DROPS: Readonly<Record<number, readonly number[]>> = {
  20: [0.19, 0.21, 0.22, 0.22],
  60: [0.11, 0.11, 0.12, 0.12],
  72: [0.09, 0.1, 0.11, 0.11],
};

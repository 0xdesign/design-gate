import { JEV_INPUT_USD_PER_MTOK } from "../types.js";

export function jevCostUsd(usage: { input_tokens: number; output_tokens: number }): number {
  return (usage.input_tokens / 1_000_000) * JEV_INPUT_USD_PER_MTOK;
}

export function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return "$0.00";
  if (value === 0) return "$0.00";
  return `$${value.toFixed(Math.abs(value) < 0.01 ? 6 : 2)}`;
}

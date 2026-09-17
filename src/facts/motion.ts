import type { DomSnapshot } from "../types.js";

export const compileMotionMeasurements = (snapshot: DomSnapshot): {
  maxDurationMs: number | null;
  motionDurationsMs: number[];
  reducedMotionRespected: boolean;
} => {
  const nonZero = snapshot.motionDurationsMs.filter((duration) => duration > 0);
  return {
    maxDurationMs: nonZero.length > 0 ? Math.max(...nonZero) : null,
    motionDurationsMs: snapshot.motionDurationsMs,
    reducedMotionRespected: snapshot.reducedMotionRespected,
  };
};

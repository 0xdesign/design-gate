import {
  bucketBodyPx,
  bucketCount,
  bucketCta,
  bucketDistinct,
  bucketDuration,
  bucketLineChars,
  bucketPalette,
  bucketShare,
  bucketVariety,
  type Brand,
  type DomSnapshot,
  type Facts,
  type Measurements,
  type ScreenAnalysis,
} from "../types.js";
import { compileA11yMeasurements, headingOutline } from "./a11y.js";
import { compileColorMeasurements } from "./color.js";
import { compileDensityMeasurements } from "./density.js";
import { compileMotionMeasurements } from "./motion.js";
import { compileShapeMeasurements } from "./shape.js";
import { compileSpaceMeasurements } from "./space.js";
import { compileTypeMeasurements, offBrandFamilies } from "./type.js";

export const compileScreen = (snapshot: DomSnapshot, brand: Brand): ScreenAnalysis => {
  const color = compileColorMeasurements(snapshot, brand);
  const typography = compileTypeMeasurements(snapshot);
  const spacing = compileSpaceMeasurements(snapshot, brand);
  const shape = compileShapeMeasurements(snapshot);
  const a11y = compileA11yMeasurements(snapshot);
  const motion = compileMotionMeasurements(snapshot);
  const density = compileDensityMeasurements(snapshot);

  const measurements: Measurements = {
    colorsUsed: color.colorsUsed,
    offTokenRatio: color.offTokenRatio,
    contrastFailures: color.contrastFailures,
    fontFamilies: typography.fontFamilies,
    fontSizesPx: typography.fontSizesPx,
    minBodyPx: typography.minBodyPx,
    longestLineChars: typography.longestLineChars,
    spacingValuesPx: spacing.spacingValuesPx,
    offGridRatio: spacing.offGridRatio,
    radiiPx: shape.radiiPx,
    shadows: shape.shadows,
    smallTargets: a11y.smallTargets,
    focusVisibleMissing: a11y.focusVisibleMissing,
    axeSerious: a11y.axeSerious,
    headingLevels: a11y.headingLevels,
    motionDurationsMs: motion.motionDurationsMs,
    ctasAboveFold: density.ctasAboveFold,
    aboveFoldElementCount: density.aboveFoldElementCount,
    horizontalOverflow: density.horizontalOverflow,
  };

  const facts: Facts = {
    screen: { route: snapshot.route, viewport: snapshot.viewport.name },
    color: {
      palette_size: bucketPalette(color.colorsUsed.length),
      off_token_share: bucketShare(color.offTokenRatio),
      off_token_examples: color.colorsUsed
        .filter((used) => used.onToken === null)
        .flatMap((used) => used.selectors.slice(0, 1).map((selector) => ({ hex: used.hex, selector })))
        .slice(0, 5),
      contrast_fails: bucketCount(color.contrastFailures.length),
    },
    type: {
      families: typography.fontFamilies,
      off_brand_families: offBrandFamilies(typography.fontFamilies, brand.type.map((entry) => entry.family)),
      distinct_sizes: bucketDistinct(typography.fontSizesPx.length),
      scale_is_regular: typography.scaleIsRegular,
      min_body_px: bucketBodyPx(typography.minBodyPx),
      longest_line_chars: bucketLineChars(typography.longestLineChars),
    },
    space: {
      grid_px: spacing.gridPx,
      off_grid_share: bucketShare(spacing.offGridRatio),
      distinct_gaps: bucketDistinct(spacing.distinctGaps),
    },
    shape: {
      radii_distinct: bucketVariety(shape.radiiPx.length),
      shadows_distinct: bucketVariety(shape.shadows.length),
    },
    a11y: {
      small_targets: bucketCount(a11y.smallTargets.length),
      focus_visible_missing: a11y.focusVisibleMissing.length > 0,
      axe_serious: bucketCount(a11y.axeSerious.reduce((sum, violation) => sum + violation.nodes, 0)),
      heading_outline: headingOutline(a11y.headingLevels),
      landmarks: snapshot.landmarks.slice(0, 8),
    },
    motion: {
      durations: bucketDuration(motion.maxDurationMs),
      reduced_motion_respected: motion.reducedMotionRespected,
    },
    density: {
      ctas_above_fold: bucketCta(density.ctasAboveFold.length),
      above_fold: density.density,
      horizontal_overflow: density.horizontalOverflow,
    },
  };

  return { snapshot, facts, measurements };
};

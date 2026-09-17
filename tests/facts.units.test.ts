import { describe, expect, it } from "vitest";
import {
  bucketBodyPx,
  bucketCount,
  bucketDuration,
  bucketShare,
  bucketVariety,
} from "../src/types.js";
import { contrastRatio, headingOutline, isScaleRegular, parseColor } from "../src/facts/index.js";

describe("fact compiler units", () => {
  it("parses CSS colors", () => {
    expect(parseColor("#fff")).toMatchObject({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor("rgb(12, 34, 56)")).toMatchObject({ r: 12, g: 34, b: 56, a: 1 });
    expect(parseColor("rgba(12, 34, 56, .5)")).toMatchObject({ r: 12, g: 34, b: 56, a: 0.5 });
    expect(parseColor("transparent")).toBeNull();
    expect(parseColor("rgba(1, 2, 3, .04)")).toBeNull();
  });

  it("computes known WCAG contrast ratios", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });

  it("uses the frozen bucket boundaries", () => {
    expect(bucketCount(6)).toBe("6+");
    expect(bucketShare(0.09)).toBe("few");
    expect(bucketShare(0.3)).toBe("some");
    expect(bucketVariety(4)).toBe("4+");
    expect(bucketBodyPx(16)).toBe("16+");
    expect(bucketDuration(300)).toBe("150-400");
  });

  it("classifies heading outlines", () => {
    expect(headingOutline([])).toBe("no_h1");
    expect(headingOutline([1, 2, 2, 3])).toBe("ok");
    expect(headingOutline([1, 3])).toBe("skips_level");
    expect(headingOutline([1, 2, 1])).toBe("multiple_h1");
  });

  it("recognizes conventional and ratio-regular type scales", () => {
    expect(isScaleRegular([12, 16, 24, 32])).toBe(true);
    expect(isScaleRegular([10, 15, 22.5, 33.75])).toBe(true);
    expect(isScaleRegular([11, 13, 29, 31])).toBe(false);
  });
});

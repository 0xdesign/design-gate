import type { Brand, CrossScreenFacts, Facts, JevState, Observations } from "../types.js";
import { stripNotes } from "../observe/schema.js";

export function buildState(args: {
  route: string;
  viewport: string;
  brand: Brand;
  facts: Facts;
  cross?: CrossScreenFacts;
  observations?: Observations;
}): JevState {
  return {
    brief: {
      route: args.route,
      viewport: args.viewport,
      ...(args.observations ? { screen_type: args.observations.screen_type } : {}),
    },
    brand: args.brand,
    facts: args.facts,
    ...(args.cross ? { cross_screen: args.cross } : {}),
    ...(args.observations ? { observations: stripNotes(args.observations) } : {}),
  };
}

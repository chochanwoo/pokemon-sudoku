import catalog from "./trainers.json" with { type: "json" };
import { hash, random } from "./engine.js";

export const TRAINERS = catalog;

export const trainerResultKey = (game, challenge, score) =>
  JSON.stringify([game, challenge, score]);

export function trainerFor(rank, resultKey = "") {
  if (!Object.hasOwn(TRAINERS, rank)) return null;
  const pool = TRAINERS[rank];
  // A completed challenge keeps its trainer across reloads, sharing and locales.
  const index = resultKey
    ? Math.floor(
        random(hash(`trainer-v1:${rank}:${resultKey}`))() * pool.length,
      )
    : 0;
  return pool[index];
}

import { readFileSync } from "node:fs";
import {
  createPokinator,
  newRound,
  viewRound,
  answerQuestion,
  rejectGuess,
} from "../web/src/pokinator-engine.js";

const read = (name) =>
  JSON.parse(
    readFileSync(new URL(`../web/public/${name}.json`, import.meta.url)),
  );
const game = createPokinator(read("pokemantle"), read("pokinator"));
const trivia = new Set(["abilities", "stats", "biology", "size", "eggs"]);
const profiles = process.argv.slice(2);
for (const profile of profiles.length
  ? profiles
  : ["database", "casual", "historical", "no-lore"]) {
  if (!["database", "casual", "historical", "no-lore"].includes(profile))
    throw new Error(`Unknown profile: ${profile}`);
  const started = performance.now(),
    counts = {},
    misses = [],
    times = [],
    lengths = [];
  let guessed = 0,
    topSix = 0;
  const pool = game.pokemon
    .map((_, i) => i)
    .filter(
      (i) =>
        profile !== "historical" ||
        game.questions.some(
          (q) => q.pastValues && q.pastValues[i] !== q.values[i],
        ),
    );
  for (const index of pool) {
    const target = game.pokemon[index],
      round = newRound(game, "pool-audit");
    for (let step = 0; step < 30; step++) {
      const start = performance.now(),
        view = viewRound(game, round);
      times.push(performance.now() - start);
      if (view.kind === "question") {
        const q = view.question;
        counts[q.group] = (counts[q.group] || 0) + 1;
        const fact =
          profile === "historical" && q.pastValues
            ? q.pastValues[index]
            : q.values[index];
        const value =
          fact === -1 ||
          (profile !== "database" && trivia.has(q.group)) ||
          (profile === "no-lore" && q.contextual)
            ? "unknown"
            : fact
              ? "yes"
              : "no";
        answerQuestion(game, round, value);
      } else if (view.kind === "guess" && view.guess.id !== target.id) {
        rejectGuess(game, round);
      } else {
        const rank = view.ranking.findIndex((p) => p.id === target.id) + 1;
        guessed += view.kind === "guess";
        topSix += rank > 0 && rank <= 6;
        lengths.push(view.answered);
        if (view.kind !== "guess") misses.push({ key: target.key, rank });
        break;
      }
    }
    if ((index + 1) % 200 === 0)
      console.log(`${profile}: ${index + 1}/${game.pokemon.length}`);
  }
  if (lengths.length !== pool.length)
    throw new Error("A round did not terminate");
  times.sort((a, b) => a - b);
  console.log(
    JSON.stringify(
      {
        profile,
        candidates: pool.length,
        guessed,
        topSix,
        meanQuestions: lengths.reduce((a, b) => a + b, 0) / lengths.length,
        questionGroups: counts,
        misses,
        p95ViewMs: times[Math.floor(times.length * 0.95)],
        seconds: (performance.now() - started) / 1000,
      },
      null,
      2,
    ),
  );
}

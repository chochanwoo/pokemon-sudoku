import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createPokinator,
  newRound,
  restoreRound,
  inference,
  viewRound,
  answerQuestion,
  rejectGuess,
  askMore,
  finishRound,
  stopRound,
  undo,
  searchCandidates,
  MAX_QUESTIONS,
} from "../web/src/pokinator-engine.js";

const read = (file) =>
  JSON.parse(
    readFileSync(new URL(`../web/public/${file}.json`, import.meta.url)),
  );
const catalog = read("pokemantle"),
  data = read("pokinator"),
  game = createPokinator(catalog, data);
const byKey = (key) => game.pokemon.find((p) => p.key === key);
function play(target, seed = "test", unknownEvery = 0, wrongAt = -1) {
  const r = newRound(game, seed),
    index = game.pokemon.indexOf(target);
  for (let i = 0; i < 35; i++) {
    const v = viewRound(game, r);
    if (v.kind === "question") {
      let answer = v.question.values[index];
      if (v.answered === wrongAt && answer !== -1) answer = 1 - answer;
      answerQuestion(
        game,
        r,
        answer === -1 || (unknownEvery && (v.answered + 1) % unknownEvery === 0)
          ? "unknown"
          : answer
            ? "yes"
            : "no",
      );
    } else if (v.kind === "guess" && v.guess.id !== target.id)
      rejectGuess(game, r);
    else return { round: r, view: v };
  }
  throw new Error("Non-terminating round");
}

test("answer policy keeps every base species, regional and Mega forms, never decorative or battle variants", () => {
  assert.equal(game.pokemon.filter((p) => p.kind === "base").length, 1025);
  const present = new Set(game.pokemon.map((p) => p.key));
  for (const key of [
    "mew",
    "arceus",
    "vivillon",
    "zygarde",
    "pichu",
    "pikachu",
    "charizard-mega-x",
    "charizard-mega-y",
    "growlithe-hisui",
    "darmanitan-galar-standard",
    "tauros-paldea-aqua-breed",
  ])
    assert.ok(present.has(key), key);
  for (const key of [
    "pikachu-gmax",
    "pichu-spiky-eared",
    "pikachu-alola-cap",
    "vivillon-meadow",
    "arceus-unknown",
    "arceus-water",
    "zygarde-10",
    "zygarde-50",
    "zygarde-complete",
    "darmanitan-galar-zen",
    "raticate-totem-alola",
    "castform-sunny",
    "groudon-primal",
  ])
    assert.ok(!present.has(key), key);
  assert.equal(byKey("zygarde").name, "지가르데");
  assert.equal(byKey("zygarde").english, "Zygarde");
  assert.equal(
    new Set(game.pokemon.map((p) => p.key)).size,
    game.pokemon.length,
  );
});

test("form-specific evidence and unknown appearance do not inherit base form traits", () => {
  const index = (key) => game.pokemon.indexOf(byKey(key));
  const fact = (q, key) => game.questionById.get(q).values[index(key)];
  assert.equal(fact("type-10", "vulpix-alola"), 0);
  assert.equal(fact("type-15", "vulpix-alola"), 1);
  assert.equal(fact("color-red", "vulpix-alola"), -1);
  assert.equal(fact("four-legs", "venusaur-mega"), -1);
  assert.equal(fact("gen-until-7", "growlithe-hisui"), 0);
  assert.equal(fact("gen-until-1", "charizard-mega-x"), 1);
});

test("priors give each species equal mass regardless of its number of forms", () => {
  const totals = new Map();
  game.pokemon.forEach((p, i) =>
    totals.set(p.speciesId, (totals.get(p.speciesId) || 0) + game.priors[i]),
  );
  for (const value of totals.values())
    assert.ok(Math.abs(value - 1 / 1025) < 1e-12);
});

test("unknown answers are neutral, missing facts stay neutral, and contradictions never eliminate candidates", () => {
  const start = inference(game, []),
    q = game.questionById.get("color-red");
  const unknown = inference(game, [
    { kind: "answer", question: q.id, value: "unknown" },
  ]);
  assert.deepEqual(unknown.weights, start.weights);
  assert.ok(unknown.asked.has(q.id));
  const yes = inference(game, [
    { kind: "answer", question: q.id, value: "yes" },
  ]);
  game.pokemon.forEach((p, i) => {
    assert.ok(yes.weights[i] > 0);
    if (q.values[i] === -1)
      assert.ok(Math.abs(yes.weights[i] - start.weights[i]) < 1e-12);
  });
  assert.ok(Math.abs(yes.weights.reduce((a, b) => a + b, 0) - 1) < 1e-12);
});

test("question selection is deterministic, adaptive and respects expert-question delays", () => {
  const a = newRound(game, "same"),
    b = newRound(game, "same");
  assert.equal(viewRound(game, a).question.id, viewRound(game, b).question.id);
  answerQuestion(game, a, "yes");
  answerQuestion(game, b, "no");
  assert.notDeepEqual(viewRound(game, a).weights, viewRound(game, b).weights);
  for (const round of [a, b]) {
    const v = viewRound(game, round);
    assert.ok(!v.asked.has(v.question.id));
    assert.ok(v.question.after <= v.answered);
  }
});

test("honest sample play converges without answer-name questions, including Mega and regional targets", () => {
  for (const key of [
    "bulbasaur",
    "pikachu",
    "mew",
    "ditto",
    "arceus",
    "zygarde",
    "vivillon",
    "rotom",
    "charizard-mega-x",
    "charizard-mega-y",
    "growlithe-hisui",
    "vulpix-alola",
    "tauros-paldea-aqua-breed",
  ]) {
    const target = byKey(key),
      { round, view } = play(target, "audit");
    assert.equal(view.kind, "guess", key);
    assert.equal(view.guess.id, target.id, key);
    assert.ok(view.answered <= MAX_QUESTIONS);
    assert.ok(finishRound(game, round));
    assert.equal(round.result.outcome, "guessed");
    assert.equal(answerQuestion(game, round, "yes"), false);
    assert.equal(undo(round), false);
  }
});

test("partially unknown or one mistaken answer can still recover the target", () => {
  for (const key of ["mew", "vulpix-alola", "charizard-mega-x", "pikachu"]) {
    const target = byKey(key),
      { view } = play(target, "audit", 4);
    assert.ok(
      view.ranking.slice(0, 6).some((p) => p.id === target.id),
      key,
    );
  }
  const target = byKey("mew"),
    { view } = play(target, "audit", 0, 0);
  assert.ok(view.ranking.slice(0, 6).some((p) => p.id === target.id));
});

test("all-unknown answers terminate honestly and the user can reveal a searched answer", () => {
  const r = newRound(game, "unknown");
  for (let i = 0; i < MAX_QUESTIONS; i++)
    assert.ok(answerQuestion(game, r, "unknown"));
  const v = viewRound(game, r);
  assert.equal(v.kind, "shortlist");
  assert.equal(v.known, 0);
  assert.equal(answerQuestion(game, r, "yes"), false);
  assert.ok(finishRound(game, r, byKey("mew").id));
  assert.equal(r.result.outcome, "revealed");
});

test("rejected guesses stay rejected until undo; asking more and rewinding preserve question identity", () => {
  const { round: r, view: original } = play(byKey("mew"), "audit");
  assert.ok(askMore(game, r));
  assert.equal(viewRound(game, r).kind, "question");
  assert.ok(undo(r));
  assert.equal(viewRound(game, r).guess.id, original.guess.id);
  assert.ok(rejectGuess(game, r));
  assert.ok(
    !viewRound(game, r).ranking.some((p) => p.id === original.guess.id),
  );
  assert.ok(undo(r));
  assert.equal(viewRound(game, r).guess.id, original.guess.id);
  const event = r.events[1];
  assert.ok(undo(r, 1));
  assert.equal(viewRound(game, r).question.id, event.question);
  assert.equal(r.events.length, 1);
});

test("saves round-trip questions, rejections, paused guesses and completed results", () => {
  const { round: r } = play(byKey("mew"), "audit");
  const check = () =>
    assert.deepEqual(restoreRound(JSON.stringify(r), game, "fallback"), r);
  check();
  askMore(game, r);
  check();
  undo(r);
  rejectGuess(game, r);
  check();
  undo(r);
  finishRound(game, r);
  check();
  const manual = newRound(game, "manual");
  stopRound(manual);
  finishRound(game, manual, byKey("pikachu").id);
  assert.deepEqual(
    restoreRound(JSON.stringify(manual), game, "fallback"),
    manual,
  );
});

test("corrupt saves and incompatible bundles fail safely without accepting impossible results", () => {
  const r = newRound(game, "valid");
  for (const bad of [
    null,
    "bad",
    {},
    { ...r, dataVersion: "stale" },
    { ...r, events: [{ kind: "answer", question: "missing", value: "yes" }] },
    { ...r, events: [{ kind: "answer", question: "mega", value: "maybe" }] },
    { ...r, result: { id: 25, outcome: "guessed" } },
    { ...r, events: [{ kind: "stop" }, { kind: "stop" }] },
  ]) {
    assert.equal(
      restoreRound(JSON.stringify(bad), game, "fallback").id,
      "fallback",
    );
  }
  assert.throws(() =>
    createPokinator(catalog, { ...data, catalogVersion: "bad" }),
  );
  assert.throws(() =>
    createPokinator(catalog, {
      ...data,
      questions: [{ ...data.questions[0], values: "0" }],
    }),
  );
  assert.throws(() =>
    createPokinator(catalog, {
      ...data,
      pokemon: [data.pokemon[0], data.pokemon[0]],
    }),
  );
});

test("bilingual search only returns the dedicated candidate pool", () => {
  for (const query of ["피카츄", "pikachu", "25"])
    assert.ok(searchCandidates(game, query).some((p) => p.key === "pikachu"));
  for (const query of ["지가르데", "zygarde"])
    assert.equal(
      searchCandidates(game, query).filter((p) => p.kind === "base").length,
      1,
    );
  assert.equal(searchCandidates(game, "pichu-spiky-eared").length, 0);
  assert.equal(searchCandidates(game, "arceus-unknown").length, 0);
});

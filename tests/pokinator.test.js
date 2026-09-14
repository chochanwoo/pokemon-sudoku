import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createPokinator,
  newRound,
  restoreRound,
  inference,
  evaluateQuestion,
  nextQuestion,
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
  assert.equal(fact("debut-sword-shield", "growlithe-hisui"), 0);
  assert.equal(fact("debut-legends-arceus", "growlithe-hisui"), 1);
  assert.equal(fact("debut-red-green-japan", "charizard-mega-x"), 1);
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

test("correlated evidence has no first-answer advantage and a type mistake has a softer penalty", () => {
  const a = { kind: "answer", question: "dual-type", value: "no" },
    b = { kind: "answer", question: "type-14", value: "yes" };
  const forward = inference(game, [a, b]),
    backward = inference(game, [b, a]);
  forward.weights.forEach((weight, i) =>
    assert.ok(Math.abs(weight - backward.weights[i]) < 1e-12),
  );
  const mime = game.pokemon.indexOf(byKey("mr-mime")),
    drowzee = game.pokemon.indexOf(byKey("drowzee")),
    first = inference(game, [a]);
  const penalty =
    first.weights[drowzee] /
    first.weights[mime] /
    (game.priors[drowzee] / game.priors[mime]);
  assert.ok(penalty < 8);
  assert.ok(first.weights[mime] > 0);
  const contradicted = inference(game, [
    a,
    { ...b, value: "no" },
    { kind: "answer", question: "type-18", value: "no" },
  ]);
  assert.ok(contradicted.weights.every((w) => w > 0));
  assert.ok(
    contradicted.reliability.get("type")[mime] <
      first.reliability.get("type")[mime],
  );
});

test("historical typing is a coherent alternative memory, not an extra independent clue", () => {
  const mime = game.pokemon.indexOf(byKey("mr-mime"));
  const answers = [
    { kind: "answer", question: "dual-type", value: "no" },
    { kind: "answer", question: "type-14", value: "yes" },
    { kind: "answer", question: "type-18", value: "no" },
  ];
  const state = inference(game, answers),
    reversed = inference(game, [...answers].reverse());
  assert.ok(state.historical.get("type")[mime] > 0.8);
  state.weights.forEach((weight, i) =>
    assert.ok(Math.abs(weight - reversed.weights[i]) < 1e-12),
  );
  assert.ok(state.weights.every((weight) => weight > 0));
  const modern = inference(
    game,
    answers.map((answer) => ({
      ...answer,
      value: game.questionById.get(answer.question).values[mime] ? "yes" : "no",
    })),
  );
  assert.ok(modern.historical.get("type")[mime] < 0.1);
  const unchanged = game.pokemon.indexOf(byKey("mew"));
  assert.ok(
    Math.abs(
      state.historical.get("type")[unchanged] /
        state.reliability.get("type")[unchanged] -
        0.25 / 0.95,
    ) < 1e-12,
  );
});

test("question gains and predicted posteriors exactly match real answer updates", () => {
  const H = (weights) =>
    [...weights].reduce((sum, p) => sum - (p ? p * Math.log2(p) : 0), 0);
  for (const events of [
    [],
    [
      { kind: "answer", question: "dual-type", value: "no" },
      { kind: "answer", question: "type-14", value: "no" },
      { kind: "answer", question: "type-18", value: "no" },
      { kind: "answer", question: "color-red", value: "no" },
      { kind: "answer", question: "ability-1", value: "unknown" },
      { kind: "reject", id: byKey("pikachu").id },
    ],
  ]) {
    const state = inference(game, events);
    for (const id of [
      "type-1",
      "type-10",
      "color-blue",
      "regional",
      "starter-family",
    ]) {
      const q = game.questionById.get(id),
        predicted = evaluateQuestion(state, q);
      const branches = ["yes", "no"].map((value) =>
        inference(game, [...events, { kind: "answer", question: id, value }]),
      );
      const p = predicted.probabilityYes;
      assert.ok(
        Math.abs(
          predicted.gain -
            (H(state.weights) -
              p * H(branches[0].weights) -
              (1 - p) * H(branches[1].weights)),
        ) < 1e-11,
        id,
      );
      branches.forEach((branch, answer) =>
        branch.weights.forEach((w, i) => {
          const likelihood = answer
            ? 1 - predicted.probabilities[i]
            : predicted.probabilities[i];
          assert.ok(
            Math.abs(
              w - (state.weights[i] * likelihood) / (answer ? 1 - p : p),
            ) < 1e-12,
            id,
          );
        }),
      );
    }
  }
});

test("contradicted category memories cannot advertise an independent fresh-question gain", () => {
  const q = game.questionById.get("type-1");
  const tinyQuestion = {
    ...q,
    values: Int8Array.of(0, 1),
    pastValues: undefined,
  };
  const fresh = { ...inference(game, []), weights: Float64Array.of(0.5, 0.5) };
  const contradicted = {
    ...fresh,
    reliability: new Map([["type", Float64Array.of(0.02, 0.02)]]),
  };
  assert.ok(evaluateQuestion(fresh, tinyQuestion).gain > 0.4);
  assert.ok(evaluateQuestion(contradicted, tinyQuestion).gain < 0.001);
});

test("within-property implications suppress questions, not candidates or unrelated evidence", () => {
  const event = (question, value = "yes") => ({
    kind: "answer",
    question,
    value,
  });
  for (const [events, blocked] of [
    [
      [event("regional", "no")],
      ["region-alola", "region-hisui", "region-paldea", "region-galar"],
    ],
    [
      [event("dual-type", "no"), event("type-14")],
      ["type-18", "type-1", "type-10"],
    ],
    [
      [event("dual-type"), event("type-14"), event("type-18")],
      ["type-1", "type-10"],
    ],
    [[event("evolved", "no")], ["third-stage"]],
    [[event("standalone")], ["evolved", "third-stage", "baby"]],
    [[event("mythical")], ["rare"]],
    [[event("bst-600")], ["bst-300", "bst-450", "bst-550"]],
    [[event("height-10", "no")], ["height-20", "height-40"]],
  ]) {
    const state = inference(game, events);
    for (const id of blocked) {
      assert.ok(state.implied.has(id), `${events[0].question}: ${id}`);
      assert.equal(
        nextQuestion(
          { ...game, questions: [game.questionById.get(id)] },
          state,
          "logic",
        ),
        null,
      );
    }
    assert.ok(state.weights.every((w) => w > 0));
  }
  const dual = inference(game, [event("dual-type"), event("type-14")]);
  assert.ok(!dual.implied.has("type-18"));
  assert.ok(!dual.implied.has("two-legs"));
  const unknown = inference(game, [event("regional", "unknown")]);
  assert.ok(!unknown.implied.has("region-hisui"));
  const inconsistent = inference(game, [
    event("dual-type", "no"),
    event("type-14"),
    event("type-18"),
  ]);
  assert.ok(!inconsistent.implied.has("type-10"));
  assert.ok(inconsistent.weights.every((w) => w > 0));
});

test("a confirmed debut stops all other debut questions without removing candidates", () => {
  const question = "debut-red-green-japan",
    event = { kind: "answer", question, value: "yes" },
    onlyDebuts = {
      ...game,
      questions: game.questions.filter((q) => q.group === "generation"),
    };
  const confirmed = inference(game, [event]);
  assert.equal(nextQuestion(onlyDebuts, confirmed, "audit"), null);
  assert.ok(confirmed.weights.every((w) => w > 0));
  for (const value of ["no", "unknown"]) {
    const next = nextQuestion(
      onlyDebuts,
      inference(game, [{ ...event, value }]),
      "audit",
    );
    assert.ok(next);
    assert.notEqual(next.id, question);
  }
  const r = newRound(game, "saved-debut");
  r.events.push(event);
  const restored = restoreRound(JSON.stringify(r), game, "fallback");
  assert.deepEqual(restored, r);
  assert.equal(
    nextQuestion(onlyDebuts, inference(game, restored.events), "audit"),
    null,
  );
  assert.ok(undo(restored));
  assert.ok(
    nextQuestion(onlyDebuts, inference(game, restored.events), "audit"),
  );
  r.events.push({ ...event, question: "debut-ruby-sapphire", value: "no" });
  const legacy = restoreRound(JSON.stringify(r), game, "fallback");
  assert.deepEqual(legacy, r);
  assert.equal(
    nextQuestion(onlyDebuts, inference(game, legacy.events), "audit"),
    null,
  );
});

test("exclusive color and region answers do not suppress unrelated or multivalued traits", () => {
  const events = ["color-red", "region-hisui"].map((question) => ({
    kind: "answer",
    question,
    value: "yes",
  }));
  const state = inference(game, events);
  const subset = (filter) => ({
    ...game,
    questions: game.questions.filter(filter),
  });
  assert.equal(
    nextQuestion(
      subset((q) => q.id.startsWith("color-")),
      state,
      "audit",
    ),
    null,
  );
  assert.equal(
    nextQuestion(
      subset((q) => q.id.startsWith("region-")),
      state,
      "audit",
    ),
    null,
  );
  for (const id of ["two-legs", "type-10"])
    assert.equal(
      nextQuestion(
        subset((q) => q.id === id),
        state,
        "audit",
      ).id,
      id,
    );
  for (const id of ["mega", "regional"]) assert.ok(state.implied.has(id));
  const dual = inference(game, [
    { kind: "answer", question: "type-14", value: "yes" },
  ]);
  assert.equal(
    nextQuestion(
      subset((q) => q.id === "type-18"),
      dual,
      "audit",
    ).id,
    "type-18",
  );
});

test("adaptive rounds never ask another debut after yes, including wrong debut memories", () => {
  for (const [key, wrongDebut] of [
    ["mr-mime", false],
    ["mew", false],
    ["gardevoir", true],
  ]) {
    const target = byKey(key),
      index = game.pokemon.indexOf(target),
      r = newRound(game, "audit");
    if (wrongDebut)
      r.events.push({
        kind: "answer",
        question: "debut-red-green-japan",
        value: "yes",
      });
    let confirmed = wrongDebut;
    let found = false;
    for (let step = 0; step < 30; step++) {
      const v = viewRound(game, r);
      if (v.kind === "question") {
        const q = v.question;
        if (confirmed) assert.notEqual(q.group, "generation", key);
        const answer =
          q.values[index] === -1 ? "unknown" : q.values[index] ? "yes" : "no";
        if (q.group === "generation" && answer === "yes") confirmed = true;
        answerQuestion(game, r, answer);
      } else if (v.kind === "guess" && v.guess.id !== target.id)
        rejectGuess(game, r);
      else {
        found = v.kind === "guess";
        break;
      }
    }
    assert.ok(confirmed, key);
    assert.ok(found, key);
  }
});

test("size and egg questions need a strong late advantage, are capped, and stop after unknown", () => {
  const regular = {
    id: "regular",
    group: "type",
    values: Int8Array.of(0, 1),
    error: 0.05,
    ease: 1,
    after: 0,
    expert: false,
  };
  const expert = {
    ...regular,
    id: "expert",
    group: "size",
    expert: true,
    error: 0.12,
    ease: 0.6,
    after: 16,
  };
  const tiny = { questions: [regular, expert] },
    state = {
      ...inference(game, []),
      weights: Float64Array.of(0.5, 0.5),
      answered: 16,
    };
  assert.equal(nextQuestion(tiny, state, "test").id, "regular");
  regular.values = Int8Array.of(1, 1);
  assert.equal(nextQuestion(tiny, state, "test").id, "expert");
  for (const extra of [
    { answered: 15 },
    { expertAnswers: 2 },
    { expertUnknown: true },
    { weights: Float64Array.of(0.995, 0.005) },
  ])
    assert.equal(nextQuestion(tiny, { ...state, ...extra }, "test"), null);
  const unknown = inference(game, [
    { kind: "answer", question: "height-10", value: "unknown" },
  ]);
  assert.equal(unknown.expertUnknown, true);
  assert.equal(unknown.expertAnswers, 1);
});

test("a low-confidence final guess uses all remaining attempts without demanding more questions", () => {
  const r = newRound(game, "uncertain"),
    questions = game.questions.slice(0, MAX_QUESTIONS);
  r.events = questions.map((q, i) => ({
    kind: "answer",
    question: q.id,
    value: i < 4 ? "yes" : "unknown",
  }));
  assert.ok(viewRound(game, r).guess.weight < 0.3);
  const rejected = new Set();
  for (let i = 0; i < 3; i++) {
    const v = viewRound(game, r);
    assert.equal(v.kind, "guess");
    assert.ok(!rejected.has(v.guess.id));
    rejected.add(v.guess.id);
    assert.ok(rejectGuess(game, r));
    assert.deepEqual(restoreRound(JSON.stringify(r), game, "fallback"), r);
  }
  assert.equal(viewRound(game, r).kind, "shortlist");
});

test("Mr Mime recovers from old single-Psychic memories without expert answers", () => {
  const target = byKey("mr-mime"),
    index = game.pokemon.indexOf(target);
  for (let seed = 0; seed < 20; seed++) {
    const r = newRound(game, `mr-mime-audit-${seed}`);
    let success = false;
    for (let step = 0; step < 30; step++) {
      const v = viewRound(game, r);
      if (v.kind === "guess") {
        if (v.guess.id === target.id) {
          success = true;
          break;
        }
        rejectGuess(game, r);
      } else if (v.kind === "question") {
        const q = v.question;
        answerQuestion(
          game,
          r,
          q.expert
            ? "unknown"
            : ["dual-type", "type-18"].includes(q.id)
              ? "no"
              : q.values[index] === -1
                ? "unknown"
                : q.values[index]
                  ? "yes"
                  : "no",
        );
      } else break;
    }
    assert.ok(success, r.id);
  }
});

test("casual players can finish representative rounds despite trivia unknowns and correlated old typings", () => {
  for (const key of [
    "mr-mime",
    "clefairy",
    "gardevoir",
    "mew",
    "pikachu",
    "ditto",
    "arceus",
    "aerodactyl",
    "charizard-mega-x",
    "growlithe-hisui",
    "vulpix-alola",
  ]) {
    const target = byKey(key),
      index = game.pokemon.indexOf(target);
    for (let seed = 0; seed < 5; seed++) {
      const r = newRound(game, `human-audit-${seed}`),
        trivia = new Map();
      let success = false;
      for (let step = 0; step < MAX_QUESTIONS + 4; step++) {
        const v = viewRound(game, r);
        if (v.kind === "guess") {
          if (v.guess.id === target.id) {
            success = true;
            break;
          }
          rejectGuess(game, r);
        } else if (v.kind === "question") {
          const q = v.question;
          let value =
            q.values[index] === -1 ? "unknown" : q.values[index] ? "yes" : "no";
          if (
            ["stats", "abilities", "size", "eggs", "biology"].includes(q.group)
          ) {
            value = "unknown";
            trivia.set(q.group, (trivia.get(q.group) || 0) + 1);
          }
          if (
            ["mr-mime", "clefairy", "gardevoir"].includes(key) &&
            ["dual-type", "type-18"].includes(q.id)
          )
            value = "no";
          if (key === "clefairy" && q.id === "type-1") value = "yes";
          answerQuestion(game, r, value);
        } else break;
      }
      assert.ok(success, `${key}: ${seed}`);
      assert.ok((trivia.get("abilities") || 0) <= 1);
      assert.ok((trivia.get("stats") || 0) <= 1);
    }
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
    assert.ok(view.expertAnswers <= 2);
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

test("compatible question additions preserve old progress and human-confirmed results across repeated reloads", () => {
  const old = newRound(game, "before-update");
  old.dataVersion = "dd9a765f728dfe67";
  old.events = [
    { kind: "answer", question: "dual-type", value: "no" },
    { kind: "answer", question: "type-14", value: "yes" },
    { kind: "answer", question: "evolved", value: "yes" },
    { kind: "answer", question: "debut-red-green-japan", value: "yes" },
  ];
  const restored = restoreRound(JSON.stringify(old), game, "fallback");
  assert.equal(restored.id, old.id);
  assert.equal(restored.dataVersion, game.dataVersion);
  assert.deepEqual(restored.events, old.events);
  assert.deepEqual(
    restoreRound(JSON.stringify(restored), game, "fallback"),
    restored,
  );
  for (const outcome of ["guessed", "revealed"]) {
    old.result = { id: byKey("mr-mime").id, outcome };
    const completed = restoreRound(JSON.stringify(old), game, "fallback");
    assert.equal(completed.result.id, old.result.id);
    assert.equal(viewRound(game, completed).kind, "complete");
    assert.deepEqual(
      restoreRound(JSON.stringify(completed), game, "fallback"),
      completed,
    );
  }
});

test("cached views update after undo, same-length answer edits and completion", () => {
  const r = newRound(game, "cache");
  const initial = viewRound(game, r);
  assert.equal(viewRound(game, r), initial);
  answerQuestion(game, r, "yes");
  const yes = viewRound(game, r);
  r.events[0].value = "no";
  const no = viewRound(game, r);
  assert.notEqual(no, yes);
  assert.notDeepEqual(no.weights, yes.weights);
  undo(r);
  assert.deepEqual(viewRound(game, r).weights, initial.weights);
  stopRound(r);
  assert.equal(viewRound(game, r).kind, "shortlist");
  finishRound(game, r, byKey("mew").id);
  assert.equal(viewRound(game, r).kind, "complete");
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

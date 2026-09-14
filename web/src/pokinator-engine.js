import { hash } from "./engine.js";
import { englishName } from "./pokemon-names.js";
import { searchForms } from "./similarity-engine.js";

export const MAX_QUESTIONS = 25;
export const MAX_GUESSES = 3;
export const MAX_EXPERT_QUESTIONS = 2;
export const STORAGE_KEY = "pokinator:round";
export const ANSWERS = ["yes", "no", "unknown"];
const normalize = (values) => {
  const total = values.reduce((a, b) => a + b, 0);
  if (!(total > 0)) throw new Error("No remaining candidates");
  return values.map((v) => v / total);
};
const entropy = (p) =>
  p > 0 && p < 1 ? -p * Math.log2(p) - (1 - p) * Math.log2(1 - p) : 0;

export function createPokinator(catalog, data) {
  if (
    data.version !== "pokinator-v2" ||
    data.policy !== "base-regional-mega-v1" ||
    data.catalogVersion !== catalog.version ||
    typeof data.dataVersion !== "string" ||
    !Array.isArray(data.pokemon) ||
    !data.pokemon.length ||
    !Array.isArray(data.questions) ||
    !data.questions.length
  )
    throw new Error("Invalid Pokinator bundle");
  const source = new Map(catalog.pokemon.map((p) => [p.id, p]));
  const pokemon = data.pokemon.map((p) => {
    const original = source.get(p.id);
    if (
      !original ||
      original.speciesId !== p.speciesId ||
      !["base", "regional", "mega"].includes(p.kind) ||
      typeof p.name !== "string" ||
      !p.name ||
      typeof p.key !== "string" ||
      (p.kind === "base" && typeof p.english !== "string")
    )
      throw new Error("Invalid candidate");
    const english = p.english || englishName(original);
    return { ...original, ...p, english, aliases: [p.name, english, p.key] };
  });
  const byId = new Map(pokemon.map((p) => [p.id, p]));
  const speciesCounts = new Map();
  for (const p of pokemon)
    speciesCounts.set(p.speciesId, (speciesCounts.get(p.speciesId) || 0) + 1);
  const questions = data.questions.map((q) => {
    if (
      !q ||
      typeof q.id !== "string" ||
      !q.id ||
      typeof q.ko !== "string" ||
      !q.ko ||
      typeof q.en !== "string" ||
      !q.en ||
      typeof q.group !== "string" ||
      !q.group ||
      typeof q.values !== "string" ||
      q.values.length !== pokemon.length ||
      /[^01?]/.test(q.values) ||
      !Number.isFinite(q.error) ||
      q.error <= 0 ||
      q.error >= 0.5 ||
      !Number.isFinite(q.ease) ||
      q.ease <= 0 ||
      q.ease > 2 ||
      !Number.isInteger(q.after) ||
      q.after < 0 ||
      q.after >= MAX_QUESTIONS ||
      typeof q.expert !== "boolean" ||
      (q.note !== undefined &&
        (!q.note ||
          typeof q.note.ko !== "string" ||
          typeof q.note.en !== "string"))
    )
      throw new Error("Invalid question");
    return {
      ...q,
      values: Int8Array.from(q.values, (v) => (v === "?" ? -1 : Number(v))),
    };
  });
  const questionById = new Map(questions.map((q) => [q.id, q]));
  if (byId.size !== pokemon.length || questionById.size !== questions.length)
    throw new Error("Duplicate Pokinator IDs");
  return {
    version: data.version,
    dataVersion: data.dataVersion,
    pokemon,
    byId,
    questions,
    questionById,
    priors: normalize(
      Float64Array.from(pokemon, (p) => 1 / speciesCounts.get(p.speciesId)),
    ),
  };
}

export function newRound(game, id) {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id || ""))
    throw new Error("Invalid round ID");
  return {
    version: game.version,
    dataVersion: game.dataVersion,
    id,
    events: [],
    result: null,
  };
}

export function restoreRound(raw, game, fallbackId) {
  try {
    const r = JSON.parse(raw);
    if (
      !r ||
      r.version !== game.version ||
      r.dataVersion !== game.dataVersion ||
      !Array.isArray(r.events) ||
      r.events.length > MAX_QUESTIONS + MAX_GUESSES + 2
    )
      throw new Error("Invalid save");
    const restored = newRound(game, r.id),
      asked = new Set(),
      rejected = new Set();
    let known = 0,
      continued = false,
      stopped = false;
    for (const e of r.events) {
      if (!e || stopped) throw new Error("Invalid event");
      if (
        e.kind === "answer" &&
        game.questionById.has(e.question) &&
        !asked.has(e.question) &&
        ANSWERS.includes(e.value) &&
        asked.size < MAX_QUESTIONS
      ) {
        asked.add(e.question);
        known += e.value !== "unknown";
        restored.events.push({
          kind: "answer",
          question: e.question,
          value: e.value,
        });
      } else if (
        e.kind === "reject" &&
        game.byId.has(e.id) &&
        !rejected.has(e.id) &&
        rejected.size < MAX_GUESSES &&
        known > 0
      ) {
        rejected.add(e.id);
        restored.events.push({ kind: "reject", id: e.id });
      } else if (e.kind === "continue" && !continued && known > 0) {
        continued = true;
        restored.events.push({ kind: "continue" });
      } else if (e.kind === "stop") {
        stopped = true;
        restored.events.push({ kind: "stop" });
      } else throw new Error("Invalid event");
    }
    if (r.result !== null) {
      if (
        !r.result ||
        !game.byId.has(r.result.id) ||
        !["guessed", "revealed"].includes(r.result.outcome)
      )
        throw new Error("Invalid result");
      const view = viewRound(game, restored);
      if (
        r.result.outcome === "guessed"
          ? view.kind !== "guess" || view.guess.id !== r.result.id
          : view.kind !== "shortlist"
      )
        throw new Error("Invalid finish");
      restored.result = { id: r.result.id, outcome: r.result.outcome };
    }
    return restored;
  } catch {
    return newRound(game, fallbackId);
  }
}

export function inference(game, events) {
  let weights = game.priors.slice();
  const groups = new Map(),
    evidenceGroups = new Map(),
    unknownGroups = new Map(),
    asked = new Set(),
    rejected = new Set();
  let answered = 0,
    known = 0,
    lastPause = -10,
    continued = false,
    expertAnswers = 0,
    expertUnknown = false;
  for (const e of events) {
    if (e.kind === "answer") {
      const q = game.questionById.get(e.question);
      asked.add(q.id);
      answered++;
      if (q.expert) {
        expertAnswers++;
        if (e.value === "unknown") expertUnknown = true;
      }
      if (e.value === "unknown") {
        unknownGroups.set(q.group, (unknownGroups.get(q.group) || 0) + 1);
        continue;
      }
      known++;
      if (!evidenceGroups.has(q.group)) evidenceGroups.set(q.group, []);
      evidenceGroups.get(q.group).push({ q, yes: e.value === "yes" ? 1 : 0 });
      groups.set(q.group, (groups.get(q.group) || 0) + 1);
    } else if (e.kind === "reject") {
      rejected.add(e.id);
      weights = normalize(
        weights.map((w, i) => (game.pokemon[i].id === e.id ? 0 : w)),
      );
      lastPause = answered;
    } else if (e.kind === "continue") {
      lastPause = answered;
      continued = true;
    }
  }
  for (const [, answers] of [...evidenceGroups].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const factors = new Float64Array(weights.length).fill(1),
      facts = new Uint8Array(weights.length);
    for (const { q, yes } of answers) {
      const miss = q.error / (1 - q.error);
      let mass = 0,
        evidence = 0;
      for (let i = 0; i < weights.length; i++) {
        if (q.values[i] === -1) continue;
        mass += weights[i];
        evidence += weights[i] * (q.values[i] === yes ? 1 : miss);
      }
      const neutral = mass > 0 ? evidence / mass : 1;
      for (let i = 0; i < weights.length; i++) {
        if (q.values[i] !== -1) facts[i]++;
        factors[i] *=
          q.values[i] === -1 ? neutral : q.values[i] === yes ? 1 : miss;
      }
    }
    // A whole category can reflect one mistaken memory (e.g. old typings).
    // Mix in a small uninformative component, capping its penalty at 20:1.
    let mass = 0,
      evidence = 0;
    for (let i = 0; i < weights.length; i++) {
      factors[i] = 0.05 + 0.95 * factors[i];
      if (facts[i]) {
        mass += weights[i];
        evidence += weights[i] * factors[i];
      }
    }
    const neutral = mass > 0 ? evidence / mass : 1;
    weights = normalize(
      weights.map((w, i) => w * (facts[i] ? factors[i] : neutral)),
    );
  }
  return {
    weights,
    groups,
    unknownGroups,
    asked,
    rejected,
    answered,
    known,
    lastPause,
    continued,
    expertAnswers,
    expertUnknown,
  };
}

export function nextQuestion(game, state, seed) {
  let best = null,
    bestScore = 0,
    expert = null,
    expertScore = 0;
  for (const q of game.questions) {
    if (state.asked.has(q.id) || q.after > state.answered) continue;
    if (
      q.expert &&
      (state.answered < 16 ||
        state.expertUnknown ||
        state.expertAnswers >= MAX_EXPERT_QUESTIONS)
    )
      continue;
    let knownMass = 0,
      yesMass = 0;
    for (let i = 0; i < state.weights.length; i++)
      if (q.values[i] !== -1) {
        knownMass += state.weights[i];
        if (q.values[i]) yesMass += state.weights[i];
      }
    if (knownMass < 0.05) continue;
    const p = q.error + ((1 - 2 * q.error) * yesMass) / knownMass;
    const gain = knownMass * (entropy(p) - entropy(q.error));
    const score =
      ((gain * q.ease) / Math.sqrt(1 + (state.groups.get(q.group) || 0))) *
      0.55 ** (state.unknownGroups.get(q.group) || 0) *
      (1 + (hash(`${seed}:${q.id}`) % 100) / 2000);
    if (q.expert) {
      // Reserve unfamiliar trivia for a substantially better late tiebreaker.
      if (gain >= 0.25 && score > expertScore + 1e-12) {
        expert = q;
        expertScore = score;
      }
    } else if (score > bestScore + 1e-12) {
      best = q;
      bestScore = score;
    }
  }
  if (expert && expertScore > bestScore * 2) return expert;
  return bestScore > 1e-8 ? best : null;
}

export function viewRound(game, round) {
  const state = inference(game, round.events);
  const ranking = game.pokemon
    .map((p, i) => ({ ...p, weight: state.weights[i] }))
    .filter((p) => !state.rejected.has(p.id))
    .sort((a, b) => b.weight - a.weight || a.id - b.id);
  const question = nextQuestion(game, state, round.id);
  const canAsk = state.answered < MAX_QUESTIONS && question !== null;
  const shortlist =
    round.events.some((e) => e.kind === "stop") ||
    state.rejected.size >= MAX_GUESSES;
  const canGuess =
    state.known >= 4 &&
    (!canAsk ||
      (state.answered - state.lastPause >= 2 && ranking[0].weight >= 0.78));
  const kind = round.result
    ? "complete"
    : shortlist
      ? "shortlist"
      : canGuess
        ? "guess"
        : canAsk
          ? "question"
          : "shortlist";
  return { ...state, kind, question, ranking, guess: ranking[0], canAsk };
}

export function answerQuestion(game, round, value) {
  const view = viewRound(game, round);
  if (view.kind !== "question" || !ANSWERS.includes(value)) return false;
  round.events.push({ kind: "answer", question: view.question.id, value });
  return true;
}
export function rejectGuess(game, round) {
  const view = viewRound(game, round);
  if (view.kind !== "guess") return false;
  round.events.push({ kind: "reject", id: view.guess.id });
  return true;
}
export function askMore(game, round) {
  const view = viewRound(game, round);
  if (view.kind !== "guess" || !view.canAsk || view.continued) return false;
  round.events.push({ kind: "continue" });
  return true;
}
export function finishRound(game, round, id = null) {
  const view = viewRound(game, round);
  if (view.kind === "guess" && id === null)
    round.result = { id: view.guess.id, outcome: "guessed" };
  else if (view.kind === "shortlist" && game.byId.has(id))
    round.result = { id, outcome: "revealed" };
  else return false;
  return true;
}
export function stopRound(round) {
  if (round.result || round.events.some((e) => e.kind === "stop")) return false;
  round.events.push({ kind: "stop" });
  return true;
}
export function undo(round, index = round.events.length - 1) {
  if (
    round.result ||
    !Number.isInteger(index) ||
    index < 0 ||
    index >= round.events.length
  )
    return false;
  round.events.splice(index);
  return true;
}
export const searchCandidates = (game, query) =>
  searchForms(game.pokemon, query);

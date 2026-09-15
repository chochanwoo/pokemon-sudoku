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
// Model priors, not confidence calibrated from real players. Each category
// mixes reliable (question error) and uninformative (coin-flip) memories.
// Type history splits trusted memory into current (0.70) and historical (0.25).
const MEMORY_PRIOR = 0.95;
const HISTORICAL_PRIOR = 0.25;
const ANSWERABILITY = {
  form: 0.95,
  type: 0.9,
  rarity: 0.9,
  evolution: 0.85,
  generation: 0.7,
  appearance: 0.9,
  recognition: 0.9,
  movies: 0.65,
  anime: 0.8,
  trainers: 0.7,
  stories: 0.75,
  "culture-games": 0.55,
  biology: 0.6,
  stats: 0.35,
  abilities: 0.4,
  size: 0.2,
  eggs: 0.15,
};
const views = new WeakMap();

function logicalFamily(q) {
  if (
    ["type", "form", "rarity", "evolution", "generation", "biology"].includes(
      q.group,
    )
  )
    return q.group;
  for (const prefix of ["color", "height", "weight", "bst"])
    if (q.id.startsWith(`${prefix}-`)) return prefix;
  return null;
}

function logicalDomains(questions, count) {
  const families = new Map();
  for (const q of questions) {
    const family = logicalFamily(q);
    if (!family) continue;
    if (!families.has(family)) families.set(family, []);
    families.get(family).push(q);
  }
  return [...families.values()].map((members) => {
    const patterns = new Set();
    for (let i = 0; i < count; i++) {
      const row = members.map((q) => q.values[i]);
      if (!row.includes(-1)) patterns.add(row.join(""));
    }
    return { members, patterns: [...patterns] };
  });
}

function impliedQuestions(game, answers) {
  const implied = new Set();
  const contradicted = new Set();
  for (const [id, ancestors] of game.ancestors) {
    if (
      answers.get(id) === 1 &&
      [...ancestors].some((parent) => answers.get(parent) === 0)
    )
      contradicted.add(game.questionById.get(id).group);
  }
  // Only reviewed subset relations count; sharing a cast member is not logic.
  for (const [id, ancestors] of game.ancestors) {
    if (contradicted.has(game.questionById.get(id).group)) continue;
    if (answers.get(id) === 1)
      for (const parent of ancestors) implied.add(parent);
    if ([...ancestors].some((parent) => answers.get(parent) === 0))
      implied.add(id);
  }
  for (const { members, patterns } of game.domains) {
    const constraints = members.flatMap((q, i) =>
      answers.has(q.id) ? [[i, answers.get(q.id)]] : [],
    );
    if (!constraints.length) continue;
    const remaining = patterns.filter((row) =>
      constraints.every(([i, value]) => Number(row[i]) === value),
    );
    // Contradictory memories suspend deductions, never remove candidates.
    if (!remaining.length) continue;
    members.forEach((q, i) => {
      if (remaining.every((row) => row[i] === remaining[0][i]))
        implied.add(q.id);
    });
  }
  return implied;
}

function questionAncestors(questionById) {
  const ancestors = new Map(),
    visiting = new Set();
  function visit(id) {
    if (!questionById.has(id) || visiting.has(id))
      throw new Error("Invalid question parent");
    if (ancestors.has(id)) return ancestors.get(id);
    visiting.add(id);
    const q = questionById.get(id),
      result = new Set();
    for (const parent of q.parents || []) {
      const above = visit(parent),
        p = questionById.get(parent);
      if (
        p.group !== q.group ||
        q.values.some(
          (v, i) =>
            (v === 1 && p.values[i] !== 1) || (v === -1 && p.values[i] === 0),
        )
      )
        throw new Error("Invalid question implication");
      result.add(parent);
      for (const ancestor of above) result.add(ancestor);
    }
    visiting.delete(id);
    ancestors.set(id, result);
    return result;
  }
  for (const id of questionById.keys()) visit(id);
  return ancestors;
}

function predictAnswer(state, q) {
  const reliability = state.reliability.get(q.group);
  const historical = state.historical.get(q.group);
  const probabilities = new Float64Array(state.weights.length);
  let knownMass = 0,
    yesMass = 0;
  for (let i = 0; i < probabilities.length; i++) {
    if (q.values[i] === -1) continue;
    const trusted = reliability ? reliability[i] : MEMORY_PRIOR;
    const past = historical
      ? historical[i]
      : q.pastValues
        ? (trusted * HISTORICAL_PRIOR) / MEMORY_PRIOR
        : 0;
    probabilities[i] =
      (trusted - past) * (q.values[i] ? 1 - q.error : q.error) +
      past * ((q.pastValues || q.values)[i] ? 1 - q.error : q.error) +
      (1 - trusted) * 0.5;
    knownMass += state.weights[i];
    yesMass += state.weights[i] * probabilities[i];
  }
  const probabilityYes = knownMass > 0 ? yesMass / knownMass : 0.5;
  // Missing database facts carry the population prediction, hence no evidence.
  for (let i = 0; i < probabilities.length; i++)
    if (q.values[i] === -1) probabilities[i] = probabilityYes;
  return { probabilities, probabilityYes, knownMass };
}

export function evaluateQuestion(state, q) {
  const prediction = predictAnswer(state, q);
  let conditionalEntropy = 0;
  for (let i = 0; i < state.weights.length; i++)
    conditionalEntropy +=
      state.weights[i] * entropy(prediction.probabilities[i]);
  return {
    ...prediction,
    gain: Math.max(0, entropy(prediction.probabilityYes) - conditionalEntropy),
  };
}

function updateBeliefs(state, q, yes) {
  const { probabilities } = predictAnswer(state, q);
  let reliability = state.reliability.get(q.group);
  if (!reliability) {
    reliability = new Float64Array(state.weights.length).fill(MEMORY_PRIOR);
    state.reliability.set(q.group, reliability);
  }
  let historical = state.historical.get(q.group);
  if (q.pastValues && !historical) {
    historical = reliability.map(
      (trusted) => (trusted * HISTORICAL_PRIOR) / MEMORY_PRIOR,
    );
    state.historical.set(q.group, historical);
  }
  state.weights = normalize(
    state.weights.map((weight, i) => {
      const likelihood = yes ? probabilities[i] : 1 - probabilities[i];
      if (q.values[i] !== -1) {
        const trustedLikelihood =
          q.values[i] === Number(yes) ? 1 - q.error : q.error;
        const past = historical ? historical[i] : 0;
        const pastLikelihood =
          (q.pastValues || q.values)[i] === Number(yes) ? 1 - q.error : q.error;
        reliability[i] =
          ((reliability[i] - past) * trustedLikelihood +
            past * pastLikelihood) /
          likelihood;
        if (historical) historical[i] = (past * pastLikelihood) / likelihood;
      }
      return weight * likelihood;
    }),
  );
}

function exclusiveFamily(question) {
  if (question.group === "generation") return "debut";
  if (question.id.startsWith("color-")) return "color";
  if (question.id.startsWith("region-")) return "region";
  return null;
}

export function createPokinator(catalog, data) {
  if (
    data.version !== "pokinator-v2" ||
    data.policy !== "base-regional-mega-v1" ||
    data.catalogVersion !== catalog.version ||
    typeof data.dataVersion !== "string" ||
    !Array.isArray(data.pokemon) ||
    !data.pokemon.length ||
    !Array.isArray(data.questions) ||
    !data.questions.length ||
    (data.compatibleDataVersions !== undefined &&
      (!Array.isArray(data.compatibleDataVersions) ||
        data.compatibleDataVersions.some(
          (version) => typeof version !== "string",
        )))
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
      (q.pastValues !== undefined &&
        (q.group !== "type" ||
          typeof q.pastValues !== "string" ||
          q.pastValues.length !== pokemon.length ||
          /[^01]/.test(q.pastValues))) ||
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
      (q.contextual !== undefined && typeof q.contextual !== "boolean") ||
      (q.retired !== undefined && typeof q.retired !== "boolean") ||
      (q.specificity !== undefined &&
        !["broad", "focused", "signature"].includes(q.specificity)) ||
      (q.parents !== undefined &&
        (!Array.isArray(q.parents) ||
          q.parents.some((id) => typeof id !== "string") ||
          new Set(q.parents).size !== q.parents.length)) ||
      (q.note !== undefined &&
        (!q.note ||
          typeof q.note.ko !== "string" ||
          typeof q.note.en !== "string"))
    )
      throw new Error("Invalid question");
    return {
      ...q,
      values: Int8Array.from(q.values, (v) => (v === "?" ? -1 : Number(v))),
      ...(q.pastValues
        ? { pastValues: Int8Array.from(q.pastValues, Number) }
        : {}),
    };
  });
  const questionById = new Map(questions.map((q) => [q.id, q]));
  if (byId.size !== pokemon.length || questionById.size !== questions.length)
    throw new Error("Duplicate Pokinator IDs");
  return {
    version: data.version,
    dataVersion: data.dataVersion,
    compatibleDataVersions: data.compatibleDataVersions || [],
    pokemon,
    byId,
    questions,
    questionById,
    ancestors: questionAncestors(questionById),
    domains: logicalDomains(questions, pokemon.length),
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
      (r.dataVersion !== game.dataVersion &&
        !game.compatibleDataVersions.includes(r.dataVersion)) ||
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
      const legacyDataVersion =
        r.result.legacyDataVersion ||
        (r.dataVersion !== game.dataVersion ? r.dataVersion : null);
      const migrated = game.compatibleDataVersions.includes(legacyDataVersion);
      if (legacyDataVersion && !migrated)
        throw new Error("Invalid result version");
      let validFinish;
      if (migrated) {
        validFinish =
          r.result.outcome === "guessed"
            ? known >= 4 &&
              !stopped &&
              !rejected.has(r.result.id) &&
              rejected.size < MAX_GUESSES
            : stopped ||
              rejected.size >= MAX_GUESSES ||
              asked.size >= MAX_QUESTIONS ||
              known > 0;
      } else {
        const view = viewRound(game, restored);
        validFinish =
          r.result.outcome === "guessed"
            ? view.kind === "guess" && view.guess.id === r.result.id
            : view.kind === "shortlist";
      }
      if (!validFinish) throw new Error("Invalid finish");
      // A human-confirmed result survives model updates and subsequent reloads.
      restored.result = {
        id: r.result.id,
        outcome: r.result.outcome,
        ...(migrated ? { legacyDataVersion } : {}),
      };
    }
    return restored;
  } catch {
    return newRound(game, fallbackId);
  }
}

export function inference(game, events) {
  const beliefs = {
    weights: game.priors.slice(),
    reliability: new Map(),
    historical: new Map(),
  };
  const groups = new Map(),
    answers = new Map(),
    unknownGroups = new Map(),
    resolvedFamilies = new Set(),
    asked = new Set(),
    rejected = new Set();
  let answered = 0,
    known = 0,
    lastPause = -10,
    lastContext = 0,
    continued = false,
    expertAnswers = 0,
    expertUnknown = false;
  for (const e of events) {
    if (e.kind === "answer") {
      const q = game.questionById.get(e.question);
      asked.add(q.id);
      answered++;
      if (q.contextual) lastContext = answered;
      if (q.expert) {
        expertAnswers++;
        if (e.value === "unknown") expertUnknown = true;
      }
      if (e.value === "unknown") {
        unknownGroups.set(q.group, (unknownGroups.get(q.group) || 0) + 1);
        continue;
      }
      known++;
      const family = exclusiveFamily(q);
      if (e.value === "yes" && family) resolvedFamilies.add(family);
      answers.set(q.id, e.value === "yes" ? 1 : 0);
      updateBeliefs(beliefs, q, e.value === "yes");
      groups.set(q.group, (groups.get(q.group) || 0) + 1);
    } else if (e.kind === "reject") {
      rejected.add(e.id);
      beliefs.weights = normalize(
        beliefs.weights.map((w, i) => (game.pokemon[i].id === e.id ? 0 : w)),
      );
      lastPause = answered;
    } else if (e.kind === "continue") {
      lastPause = answered;
      continued = true;
    }
  }
  return {
    ...beliefs,
    focus: candidateFocus(game, beliefs.weights),
    groups,
    unknownGroups,
    resolvedFamilies,
    implied: impliedQuestions(game, answers),
    asked,
    rejected,
    answered,
    known,
    lastPause,
    lastContext,
    continued,
    expertAnswers,
    expertUnknown,
  };
}

function candidateFocus(game, weights) {
  // Lore is species-based, so multiple forms must not inflate the shortlist.
  const species = new Map();
  game.pokemon.forEach((p, i) =>
    species.set(p.speciesId, (species.get(p.speciesId) || 0) + weights[i]),
  );
  const ranked = [...species].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const mass = (count) =>
    ranked.slice(0, count).reduce((sum, [, weight]) => sum + weight, 0);
  return {
    topEight: mass(8),
    topTwenty: mass(20),
    leading: new Set(ranked.slice(0, 3).map(([id]) => id)),
  };
}

export function isQuestionReady(game, state, q) {
  if (q.retired) return false;
  if (!q.specificity || q.specificity === "broad") return true;
  const signature = q.specificity === "signature";
  if (state.known < (signature ? 6 : 4)) return false;
  const focus = state.focus || candidateFocus(game, state.weights);
  if ((signature ? focus.topEight : focus.topTwenty) < (signature ? 0.65 : 0.5))
    return false;
  let yesMass = 0,
    knownMass = 0,
    matchesLeader = false;
  q.values.forEach((value, i) => {
    if (value !== -1) knownMass += state.weights[i];
    if (value === 1) {
      yesMass += state.weights[i];
      if (focus.leading.has(game.pokemon[i].speciesId)) matchesLeader = true;
    }
  });
  // Use raw positive evidence, not P(yes), whose error floor can look plausible.
  return (
    knownMass >= 0.75 &&
    yesMass >= (signature ? 0.25 : 0.12) &&
    (!signature || matchesLeader)
  );
}

export function nextQuestion(game, state, seed) {
  let best = null,
    bestScore = 0,
    contextual = null,
    contextScore = 0,
    expert = null,
    expertScore = 0;
  for (const q of game.questions) {
    if (q.retired || state.asked.has(q.id) || q.after > state.answered)
      continue;
    if (!isQuestionReady(game, state, q)) continue;
    // A confirmed single-valued fact needs no more alternatives. This only
    // suppresses redundant questions; soft candidate weights remain intact.
    if (
      state.resolvedFamilies.has(exclusiveFamily(q)) ||
      state.implied.has(q.id)
    )
      continue;
    if (
      q.expert &&
      (state.answered < 16 ||
        state.expertUnknown ||
        state.expertAnswers >= MAX_EXPERT_QUESTIONS)
    )
      continue;
    const known = state.groups.get(q.group) || 0;
    const unknown = state.unknownGroups.get(q.group) || 0;
    if (["abilities", "stats"].includes(q.group) && unknown > 0 && known === 0)
      continue;
    if (q.contextual && unknown >= 2 && known === 0) continue;
    const { knownMass, gain } = evaluateQuestion(state, q);
    if (knownMass < 0.05) continue;
    const answerability =
      (3 * (ANSWERABILITY[q.group] || 0.7) + known) / (3 + known + unknown);
    const score =
      gain *
      q.ease *
      answerability *
      (1 + (hash(`${seed}:${q.id}`) % 100) / 2000);
    if (q.contextual && gain >= 0.08 && score > contextScore + 1e-12) {
      contextual = q;
      contextScore = score;
    }
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
  // Give useful franchise memories a turn, without forcing irrelevant trivia.
  if (
    contextual &&
    state.answered - state.lastContext >= 3 &&
    contextScore >= bestScore * 0.6
  )
    return contextual;
  return bestScore > 1e-8 ? best : null;
}

export function viewRound(game, round) {
  const signature = JSON.stringify(round);
  const cached = views.get(round);
  if (cached?.game === game && cached.signature === signature)
    return cached.view;
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
  const view = { ...state, kind, question, ranking, guess: ranking[0], canAsk };
  views.set(round, { game, signature, view });
  return view;
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

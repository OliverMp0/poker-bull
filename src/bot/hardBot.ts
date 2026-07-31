import type { Call, Card, GameState, Player, Rank, Suit } from "../game/types";
import { compareCalls, isCallSatisfied } from "../game/calls";
import { handSizeForLosses, nextActiveIndex } from "../game/engine";
import type { BotAction } from "./simpleBot";

/**
 * "Hard mode" bot. Approximates an MCCFR (Monte Carlo Counterfactual Regret
 * Minimization) solver, tuned aggressively so the UI never stalls.
 */

const TIME_BUDGET_MS = 3000;
const MAX_ITERATIONS = 400;
const MAX_CANDIDATE_RAISES = 20;
const ROLLOUT_PLIES = 30;
// Probability tuning for the realistic opponent model used in rollouts.
const CHALLENGE_BASE_RELUCTANCE = 0.12;
const TRUE_CALL_NOISE = 0.02;

export function chooseHardBotAction(
  gs: GameState,
  botIndex: number,
  allCallsSorted: Call[]
): BotAction {
  const candidates = buildCandidateActions(gs, allCallsSorted);
  if (candidates.length === 1) return candidates[0];

  const n = candidates.length;
  const regretSum = new Array<number>(n).fill(0);
  const strategySum = new Array<number>(n).fill(0);

  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  const deadline = now() + TIME_BUDGET_MS;

  for (let it = 0; it < MAX_ITERATIONS; it++) {
    if (now() > deadline) break;

    const world = sampleWorld(gs, botIndex);
    if (!world) continue;

    const strategy = regretMatch(regretSum);
    for (let a = 0; a < n; a++) strategySum[a] += strategy[a];

    const utils = new Array<number>(n);
    for (let a = 0; a < n; a++) {
      utils[a] = simulateAction(world, botIndex, candidates[a]);
    }
    let nodeUtil = 0;
    for (let a = 0; a < n; a++) nodeUtil += utils[a] * strategy[a];
    for (let a = 0; a < n; a++) regretSum[a] += utils[a] - nodeUtil;
  }

  const avg = normalize(strategySum);
  let r = Math.random();
  for (let a = 0; a < n; a++) {
    r -= avg[a];
    if (r <= 0) return candidates[a];
  }
  return candidates[candidates.length - 1];
}

function buildCandidateActions(gs: GameState, allCallsSorted: Call[]): BotAction[] {
  const out: BotAction[] = [];
  if (gs.round.lastCall) out.push({ type: "CHALLENGE" });

  const last = gs.round.lastCall;

  // Gather *all* legal raises (the sorted list is finite ~ a few thousand).
  const raises: Call[] = [];
  let started = !last;
  for (const c of allCallsSorted) {
    if (!started) {
      if (compareCalls(last!, c) < 0) started = true;
      else continue;
    }
    raises.push(c);
  }
  if (raises.length === 0) return out;

  const myHand = gs.players[gs.round.turnIndex].hand;
  const myCounts = new Map<Rank, number>();
  for (const c of myHand) myCounts.set(c.rank, (myCounts.get(c.rank) ?? 0) + 1);

  // Bucket raises by *kind* so we always have candidates of every shape.
  // After a SINGLE, the sorted list is dominated by thousands of higher
  // SINGLE variants — without bucketing we'd never even consider a PAIR.
  const byKind = new Map<Call["kind"], number[]>();
  for (let i = 0; i < raises.length; i++) {
    const k = raises[i].kind;
    const arr = byKind.get(k) ?? [];
    arr.push(i);
    byKind.set(k, arr);
  }

  const picked = new Set<number>();
  const addIdx = (i: number) => { if (i >= 0 && i < raises.length) picked.add(i); };

  // (1) For each kind that's legal as a raise, include:
  //      - the cheapest variant of that kind,
  //      - the strongest *truthful* variant of that kind (best safe bluff cover),
  //      - the cheapest *truthful* variant of that kind (safest commitment).
  for (const [, idxs] of byKind) {
    addIdx(idxs[0]); // cheapest variant of this kind

    let firstTrue = -1, lastTrue = -1;
    for (const i of idxs) {
      if (isCallSatisfied(raises[i], myHand)) {
        if (firstTrue < 0) firstTrue = i;
        lastTrue = i;
      }
    }
    if (firstTrue >= 0) { addIdx(firstTrue); addIdx(lastTrue); }
  }

  // (2) Across the whole ladder, include strongest truthful raise overall and
  //     the 2-3 raises immediately above it (the most strategic bluffs).
  let bestTruthful = -1;
  for (let i = 0; i < raises.length; i++) {
    if (isCallSatisfied(raises[i], myHand)) bestTruthful = i;
  }
  if (bestTruthful >= 0) {
    addIdx(bestTruthful);
    for (let off = 1; off <= 3; off++) addIdx(bestTruthful + off);
  } else {
    // No truthful raise: bluff candidates are the cheapest of each shape
    // (already covered) plus a couple of small structural upgrades.
    addIdx(0); addIdx(1); addIdx(2);
  }

  // (3) Bluff candidates that lean on PAIRS we already hold (e.g. we have a
  //     pair of 6s — include PAIR-7s and PAIR-8s as plausible bluffs).
  for (const [rank, count] of myCounts) {
    if (count >= 2) {
      for (let r = (rank + 1) as Rank; (r as number) <= 14; r = ((r as number) + 1) as Rank) {
        const target: Call = { kind: "PAIR", rank: r, kickers: [] };
        if (!last || compareCalls(last, target) < 0) {
          const idx = findCallIndex(raises, target);
          if (idx >= 0) { addIdx(idx); break; }
        }
      }
    }
    if (count >= 1) {
      // SINGLE bumps based on real cards we hold.
      const single: Call = { kind: "SINGLE", rank, kickers: [] };
      if (!last || compareCalls(last, single) < 0) addIdx(findCallIndex(raises, single));
    }
  }

  // (4) Fill any remaining slots with an evenly spaced sample across the full
  //     ladder so very bold bluffs are also represented.
  if (picked.size < MAX_CANDIDATE_RAISES && raises.length > 0) {
    const need = MAX_CANDIDATE_RAISES - picked.size;
    const step = Math.max(1, Math.floor(raises.length / (need + 1)));
    for (let i = 0; i < raises.length && picked.size < MAX_CANDIDATE_RAISES; i += step) {
      addIdx(i);
    }
  }

  // Hard cap to keep the search loop tractable.
  const sorted = Array.from(picked).sort((a, b) => a - b).slice(0, MAX_CANDIDATE_RAISES);
  for (const idx of sorted) out.push({ type: "RAISE", call: raises[idx] });
  return out;
}

function findCallIndex(raises: Call[], target: Call): number {
  for (let i = 0; i < raises.length; i++) {
    if (compareCalls(raises[i], target) === 0) return i;
  }
  return -1;
}

type World = {
  players: Player[];
  lastCall: Call | null;
  lastCallerIndex: number | null;
  turnIndex: number;
};

function sampleWorld(gs: GameState, botIndex: number): World | null {
  const players = gs.players.map(p => ({ ...p, hand: p.hand.slice() }));
  const seen = new Set<string>();
  for (const c of gs.players[botIndex].hand) seen.add(cardKey(c));

  const unseen: Card[] = [];
  const suits: Suit[] = ["C", "D", "H", "S"];
  for (let r = 2; r <= 14; r++) {
    for (const s of suits) {
      const c: Card = { rank: r as Rank, suit: s };
      if (!seen.has(cardKey(c))) unseen.push(c);
    }
  }
  shuffleInPlace(unseen);

  let di = 0;
  for (let i = 0; i < players.length; i++) {
    if (i === botIndex) continue;
    const p = players[i];
    if (p.eliminated) { p.hand = []; continue; }
    const need = handSizeForLosses(p.losses);
    if (di + need > unseen.length) return null;
    p.hand = unseen.slice(di, di + need);
    di += need;
  }

  return {
    players,
    lastCall: gs.round.lastCall,
    lastCallerIndex: gs.round.lastCallerIndex,
    turnIndex: gs.round.turnIndex,
  };
}

function cardKey(c: Card): string { return c.rank + c.suit; }

function shuffleInPlace<T>(a: T[]): void {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
}

function cloneWorld(w: World): World {
  return {
    players: w.players.map(p => ({ ...p, hand: p.hand.slice() })),
    lastCall: w.lastCall,
    lastCallerIndex: w.lastCallerIndex,
    turnIndex: w.turnIndex,
  };
}

function simulateAction(world: World, botIndex: number, action: BotAction): number {
  const w = cloneWorld(world);
  const outcome = applyAction(w, botIndex, action);
  if (outcome !== null) return scoreOutcome(w, outcome, botIndex);
  return rollout(w, botIndex);
}

function applyAction(w: World, actor: number, action: BotAction): number | null {
  if (action.type === "CHALLENGE") {
    if (!w.lastCall || w.lastCallerIndex === null) return actor;
    const allCards: Card[] = [];
    for (let i = 0; i < w.players.length; i++) {
      if (!w.players[i].eliminated) {
        for (const c of w.players[i].hand) allCards.push(c);
      }
    }
    const satisfied = isCallSatisfied(w.lastCall, allCards);
    return satisfied ? actor : w.lastCallerIndex;
  }
  w.lastCall = action.call;
  w.lastCallerIndex = actor;
  w.turnIndex = nextActiveIndex(w.players, actor);
  return null;
}

function rollout(w: World, botIndex: number): number {
  for (let ply = 0; ply < ROLLOUT_PLIES; ply++) {
    const ti = w.turnIndex;
    const action = realisticPolicy(w, ti);
    const outcome = applyAction(w, ti, action);
    if (outcome !== null) return scoreOutcome(w, outcome, botIndex);
  }
  return 0;
}

/**
 * Realistic opponent model used inside rollouts. Crucially each opponent
 * sees ONLY its own hand (not the whole sampled world) — otherwise bluffs
 * would always be caught and MCCFR would learn to never bluff, making the
 * bot trivially exploitable.
 *
 * The model is the same hypergeometric-suspicion reasoning the simple bot
 * uses, but executed cheaply and without all the per-call allocation.
 */
function realisticPolicy(w: World, actor: number): BotAction {
  const last = w.lastCall;
  const hand = w.players[actor].hand;

  // 1. Challenge decision (only if there is a standing call from someone else).
  if (last && w.lastCallerIndex !== null && w.lastCallerIndex !== actor) {
    // If our own hand already proves the call, never challenge.
    if (!isCallSatisfied(last, hand)) {
      const myCounts = new Map<Rank, number>();
      for (const c of hand) myCounts.set(c.rank, (myCounts.get(c.rank) ?? 0) + 1);
      const myHandSize = hand.length;

      // Total unseen cards from the actor's perspective.
      let otherCards = 0;
      for (let i = 0; i < w.players.length; i++) {
        if (i !== actor && !w.players[i].eliminated) otherCards += w.players[i].hand.length;
      }

      const need = callNeeds(last);
      let pTrue = 1.0;
      for (const [rank, required] of need) {
        const have = myCounts.get(rank) ?? 0;
        const shortfall = required - have;
        if (shortfall <= 0) continue;
        const remainingRank = 4 - have;
        if (remainingRank < shortfall) { pTrue = 0; break; }
        // Approximate P(>=shortfall in `otherCards` draws from a pool of
        // (52 - myHandSize) unseen cards of which `remainingRank` are hits).
        // Use the cheap mean ratio as a proxy (avoid logFactorials).
        const expected = (otherCards * remainingRank) / Math.max(1, (52 - myHandSize));
        // Sigmoid-ish: probability of meeting shortfall.
        const p = clamp01((expected - shortfall + 1) / 2);
        pTrue *= p;
      }

      const pChallenge = clamp01((1 - pTrue) - CHALLENGE_BASE_RELUCTANCE);
      if (Math.random() < pChallenge) return { type: "CHALLENGE" };
    } else {
      // Call is satisfied by our own hand — never challenge it, but with tiny
      // noise to keep the rollout from being fully deterministic.
      if (Math.random() < TRUE_CALL_NOISE) return { type: "CHALLENGE" };
    }
  }

  // 2. Raise decision: prefer a truthful raise (something our own hand still
  // satisfies); else bluff a minimal raise.
  if (!last) {
    const topRank = hand.reduce((m, c) => c.rank > m ? c.rank : m, 2 as Rank);
    return { type: "RAISE", call: { kind: "SINGLE", rank: topRank, kickers: [] } };
  }

  // Try a couple of small structural raises off the top of our hand.
  const truthful = pickQuickTruthfulRaise(last, hand);
  if (truthful) return { type: "RAISE", call: truthful };
  return { type: "RAISE", call: minimalRaiseFrom(last) };
}

/**
 * Cheap attempt to construct a strictly-higher raise that our own hand
 * already satisfies. Doesn't enumerate everything — just a few obvious
 * upgrades based on our most-held ranks.
 */
function pickQuickTruthfulRaise(last: Call, hand: Card[]): Call | null {
  const counts = new Map<Rank, number>();
  for (const c of hand) counts.set(c.rank, (counts.get(c.rank) ?? 0) + 1);
  const ranksDesc = Array.from(counts.entries()).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return b[0] - a[0];
  });

  // Try the minimal raise first.
  const minimal = minimalRaiseFrom(last);
  if (isCallSatisfied(minimal, hand)) return minimal;

  // Try promoting to our strongest holding.
  for (const [rank, count] of ranksDesc) {
    const candidates: Call[] = [];
    if (count >= 4) candidates.push({ kind: "QUADS", rank });
    if (count >= 3) candidates.push({ kind: "TRIPS", rank, kickers: [] });
    if (count >= 2) candidates.push({ kind: "PAIR", rank, kickers: [] });
    candidates.push({ kind: "SINGLE", rank, kickers: [] });
    for (const c of candidates) {
      if (compareCalls(last, c) < 0 && isCallSatisfied(c, hand)) return c;
    }
  }
  return null;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function minimalRaiseFrom(last: Call): Call {
  switch (last.kind) {
    case "SINGLE":
      if (last.rank < 14) return { kind: "SINGLE", rank: (last.rank + 1) as Rank, kickers: [] };
      return { kind: "PAIR", rank: 2 as Rank, kickers: [] };
    case "PAIR":
      if (last.rank < 14) return { kind: "PAIR", rank: (last.rank + 1) as Rank, kickers: [] };
      return { kind: "TWO_PAIR", high: 3 as Rank, low: 2 as Rank };
    case "TWO_PAIR":
      if (last.high < 14) return { kind: "TWO_PAIR", high: (last.high + 1) as Rank, low: last.low };
      return { kind: "TRIPS", rank: 2 as Rank, kickers: [] };
    case "TRIPS":
      if (last.rank < 14) return { kind: "TRIPS", rank: (last.rank + 1) as Rank, kickers: [] };
      return { kind: "FULL_HOUSE", trips: 3 as Rank, pair: 2 as Rank };
    case "FULL_HOUSE": {
      if (last.trips < 14) {
        const nextTrips = (last.trips + 1) as Rank;
        const pair = (last.pair === nextTrips ? 2 : last.pair) as Rank;
        return { kind: "FULL_HOUSE", trips: nextTrips, pair };
      }
      return { kind: "QUADS", rank: 2 as Rank };
    }
    case "QUADS":
      if (last.rank < 14) return { kind: "QUADS", rank: (last.rank + 1) as Rank };
      return { kind: "QUADS", rank: 14 as Rank, kicker: 13 as Rank };
  }
}

function callNeeds(call: Call): Map<Rank, number> {
  const m = new Map<Rank, number>();
  const add = (r: Rank, n: number) => m.set(r, Math.max(m.get(r) ?? 0, n));
  switch (call.kind) {
    case "SINGLE": add(call.rank, 1); for (const k of call.kickers) add(k, 1); break;
    case "PAIR": add(call.rank, 2); for (const k of call.kickers) add(k, 1); break;
    case "TWO_PAIR": add(call.high, 2); add(call.low, 2); if (call.kicker) add(call.kicker, 1); break;
    case "TRIPS": add(call.rank, 3); for (const k of call.kickers) add(k, 1); break;
    case "FULL_HOUSE": add(call.trips, 3); add(call.pair, 2); break;
    case "QUADS": add(call.rank, 4); if (call.kicker) add(call.kicker, 1); break;
  }
  return m;
}

function scoreOutcome(w: World, loserIndex: number, botIndex: number): number {
  // Weight loss by how close it brings us to elimination (5 cards).
  if (loserIndex === botIndex) {
    const cards = w.players[botIndex].hand.length;
    return -1 - cards * 0.25; // -1.25 at 1 card, -2.25 at 5 cards (elimination)
  }
  const loserCards = w.players[loserIndex].hand.length;
  // Bigger reward if loser was already on the brink.
  return 1 + loserCards * 0.15;
}

function regretMatch(regretSum: number[]): number[] {
  const n = regretSum.length;
  const pos = new Array<number>(n);
  let total = 0;
  for (let i = 0; i < n; i++) {
    const r = regretSum[i] > 0 ? regretSum[i] : 0;
    pos[i] = r;
    total += r;
  }
  if (total <= 0) return new Array<number>(n).fill(1 / n);
  for (let i = 0; i < n; i++) pos[i] /= total;
  return pos;
}

function normalize(v: number[]): number[] {
  let total = 0;
  for (const x of v) total += x;
  if (total <= 0) return v.map(() => 1 / v.length);
  return v.map(x => x / total);
}

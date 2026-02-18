import type { Call, Card, GameState, Rank } from "../game/types";
import { compareCalls, isCallSatisfied, kindOrder } from "../game/calls";
import { activeIndices } from "../game/engine";

export type BotAction =
  | { type: "RAISE"; call: Call }
  | { type: "CHALLENGE" };

export function chooseBotAction(gs: GameState, botIndex: number, allCallsSorted: Call[]): BotAction {
  const last = gs.round.lastCall;
  const hand = gs.players[botIndex].hand;

  const act = activeIndices(gs.players);
  const totalCards = act.reduce((s, i) => s + gs.players[i].hand.length, 0);
  const otherCards = totalCards - hand.length;

  // Build rank counts from own hand
  const myCounts = new Map<Rank, number>();
  for (const c of hand) myCounts.set(c.rank, (myCounts.get(c.rank) ?? 0) + 1);
  const myHandSize = hand.length;

  // --- decide whether to challenge ---
  if (last) {
    // If our own hand already satisfies the call, never challenge
    const ownSatisfied = isCallSatisfied(last, hand);
    if (!ownSatisfied) {
      const pTrue = estimateCallProbability(last, myCounts, myHandSize, otherCards);
      const callStrength = indexStrength(last, allCallsSorted);

      // Risk factor: how many cards we have (more cards = more to lose if eliminated)
      const riskPenalty = myHandSize / 5; // 0.2 for 1 card, 1.0 for 5 cards

      // Negative-evidence factor: for each rank the call needs that we hold ZERO of,
      // with a large hand, that's strong evidence against the call existing.
      // E.g., 4 cards and 0 eights → we've "searched" 4/52 of the deck and found nothing.
      const need = callNeeds(last);
      let negativeEvidence = 0;
      for (const [rank, required] of need) {
        const have = myCounts.get(rank) ?? 0;
        if (have === 0 && required >= 1) {
          // We hold myHandSize cards and found 0 of this rank.
          // The more cards we hold, the more suspicious this is.
          negativeEvidence += myHandSize / 10; // 0.1 per card we hold per missing rank
        }
      }

      // Base challenge probability:
      // - Higher when call probability is low (pTrue close to 0)
      // - Higher when call is strong (harder to raise above it)
      // - Higher when we have more cards (more at stake, so call bluffs more)
      // - Higher with negative evidence
      const pChallenge = clamp01(
        (1 - pTrue) * 0.7        // core: challenge when call seems false
        + callStrength * 0.25     // harder to raise over strong calls
        + negativeEvidence * 0.3  // our hand contradicts the call
        + riskPenalty * 0.15      // more cards at stake
        - 0.25                    // base reluctance
      );

      if (Math.random() < pChallenge) {
        return { type: "CHALLENGE" };
      }
    }
  }

  // --- find a good raise ---
  const candidates = getCandidateRaises(last, allCallsSorted, 80);

  let bestCall: Call | null = null;
  let bestScore = -Infinity;

  for (const c of candidates) {
    const ownSatisfied = isCallSatisfied(c, hand);
    const pTrue = ownSatisfied ? 1.0 : estimateCallProbability(c, myCounts, myHandSize, otherCards);
    const strength = indexStrength(c, allCallsSorted);

    // Strongly prefer calls our hand can back up (truthful play)
    // Penalize escalation, but don't mind low-strength truthful calls at all
    let score: number;
    if (ownSatisfied) {
      // Great: our hand alone proves this. Prefer the lowest such call.
      score = 3.0 - strength * 1.0;
    } else if (pTrue > 0.7) {
      // Likely true with other players' cards. Acceptable but less ideal.
      score = pTrue * 1.5 - strength * 1.5;
    } else {
      // Bluff territory — heavily penalize unless no better option
      score = pTrue * 0.8 - strength * 2.5 - 0.5;
    }

    if (score > bestScore) {
      bestScore = score;
      bestCall = c;
    }
  }

  if (!bestCall) {
    bestCall = minimalRaise(last, allCallsSorted);
  }

  return { type: "RAISE", call: bestCall };
}

/** Get the first N valid raises above `last`. */
function getCandidateRaises(last: Call | null, allCallsSorted: Call[], maxCount: number): Call[] {
  const out: Call[] = [];
  let started = !last;
  for (const c of allCallsSorted) {
    if (!started) {
      if (compareCalls(last!, c) < 0) started = true;
      else continue;
    }
    out.push(c);
    if (out.length >= maxCount) break;
  }
  return out;
}

function minimalRaise(last: Call | null, allCallsSorted: Call[]): Call {
  if (!last) return allCallsSorted[0];
  for (const c of allCallsSorted) {
    if (compareCalls(last, c) < 0) return c;
  }
  return allCallsSorted[allCallsSorted.length - 1];
}

/**
 * Estimate the probability that a call is true across ALL dealt cards,
 * given what we know from our own hand.
 *
 * Uses hypergeometric distribution: for each rank the call requires,
 * compute the probability that the other players' cards fill our shortfall.
 * Multiply across independent ranks (approximation — slight overestimate of
 * joint probability, but good enough for decision-making).
 */
function estimateCallProbability(
  call: Call,
  myCounts: Map<Rank, number>,
  myHandSize: number,
  otherCards: number
): number {
  const need = callNeeds(call);
  let prob = 1.0;

  for (const [rank, required] of need) {
    const have = myCounts.get(rank) ?? 0;
    const shortfall = Math.max(0, required - have);
    if (shortfall === 0) continue;

    // Cards of this rank remaining in the unobserved portion of the deck
    const remaining = 4 - have;
    // Total unobserved cards (full deck minus our hand)
    const deckRemaining = 52 - myHandSize;

    if (remaining < shortfall) {
      prob = 0;
      break;
    }

    const p = hypergeometricAtLeast(shortfall, remaining, deckRemaining, otherCards);
    prob *= p;
  }

  return clamp01(prob);
}

/** Return map of rank -> minimum count needed for the call. */
function callNeeds(call: Call): Map<Rank, number> {
  const m = new Map<Rank, number>();
  const add = (r: Rank, n: number) => m.set(r, Math.max(m.get(r) ?? 0, n));

  switch (call.kind) {
    case "SINGLE":
      add(call.rank, 1);
      for (const k of call.kickers) add(k, 1);
      break;
    case "PAIR":
      add(call.rank, 2);
      for (const k of call.kickers) add(k, 1);
      break;
    case "TWO_PAIR":
      add(call.high, 2);
      add(call.low, 2);
      if (call.kicker) add(call.kicker, 1);
      break;
    case "TRIPS":
      add(call.rank, 3);
      for (const k of call.kickers) add(k, 1);
      break;
    case "FULL_HOUSE":
      add(call.trips, 3);
      add(call.pair, 2);
      break;
    case "QUADS":
      add(call.rank, 4);
      if (call.kicker) add(call.kicker, 1);
      break;
  }
  return m;
}

/**
 * Probability of drawing >= k successes from a population of N items
 * with K successes, drawing n items (hypergeometric).
 */
function hypergeometricAtLeast(k: number, K: number, N: number, n: number): number {
  if (k <= 0) return 1;
  if (K < k) return 0;
  if (n <= 0) return 0;
  if (n >= N) return K >= k ? 1 : 0;

  let cumulative = 0;
  for (let i = 0; i < k; i++) {
    cumulative += hypergeometricPmf(i, K, N, n);
  }
  return clamp01(1 - cumulative);
}

function hypergeometricPmf(x: number, K: number, N: number, n: number): number {
  if (x > K || x > n || (n - x) > (N - K)) return 0;
  return Math.exp(
    lnComb(K, x) + lnComb(N - K, n - x) - lnComb(N, n)
  );
}

function lnComb(n: number, k: number): number {
  if (k < 0 || k > n) return -Infinity;
  if (k === 0 || k === n) return 0;
  return lnFactorial(n) - lnFactorial(k) - lnFactorial(n - k);
}

const lnFactCache: number[] = [0, 0];
function lnFactorial(n: number): number {
  if (n < 0) return 0;
  if (n < lnFactCache.length) return lnFactCache[n];
  let val = lnFactCache[lnFactCache.length - 1];
  for (let i = lnFactCache.length; i <= n; i++) {
    val += Math.log(i);
    lnFactCache.push(val);
  }
  return val;
}

function indexStrength(call: Call, allCallsSorted: Call[]): number {
  for (let i = 0; i < allCallsSorted.length; i++) {
    if (compareCalls(call, allCallsSorted[i]) <= 0) return i / (allCallsSorted.length - 1);
  }
  return 1;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

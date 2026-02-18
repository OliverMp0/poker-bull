import type { Call, CallKind, Card, Rank } from "./types";  
  
export const RANKS_DESC: Rank[] = [14,13,12,11,10,9,8,7,6,5,4,3,2];  
  
export function rankLabel(r: Rank): string {  
  if (r === 14) return "A";  
  if (r === 13) return "K";  
  if (r === 12) return "Q";  
  if (r === 11) return "J";  
  return String(r);  
}  
  
export function callToString(c: Call): string {  
  switch (c.kind) {  
    case "SINGLE":  
      return `High card ${rankLabel(c.rank)}${c.kickers.length ? `, kickers ${c.kickers.map(rankLabel).join(",")}` : ""}`;  
    case "PAIR":  
      return `Pair ${rankLabel(c.rank)}${c.kickers.length ? `, kickers ${c.kickers.map(rankLabel).join(",")}` : ""}`;  
    case "TWO_PAIR":  
      return `Two pair ${rankLabel(c.high)} & ${rankLabel(c.low)}${c.kicker ? ` + ${rankLabel(c.kicker)}` : ""}`;  
    case "TRIPS":  
      return `Trips ${rankLabel(c.rank)}${c.kickers.length ? `, kickers ${c.kickers.map(rankLabel).join(",")}` : ""}`;  
    case "FULL_HOUSE":  
      return `${rankLabel(c.trips)} full of ${rankLabel(c.pair)}`;  
    case "QUADS":  
      return `Quads ${rankLabel(c.rank)}${c.kicker ? ` + ${rankLabel(c.kicker)}` : ""}`;  
  }  
}  
  
export function kickerSlots(kind: CallKind): number {  
  switch (kind) {  
    case "SINGLE": return 4;  
    case "PAIR": return 3;  
    case "TWO_PAIR": return 1;  
    case "TRIPS": return 2;  
    case "FULL_HOUSE": return 0;  
    case "QUADS": return 1;  
  }  
}  
  
export function kindOrder(kind: CallKind): number {  
  switch (kind) {  
    case "SINGLE": return 0;  
    case "PAIR": return 1;  
    case "TWO_PAIR": return 2;  
    case "TRIPS": return 3;  
    case "FULL_HOUSE": return 4;  
    case "QUADS": return 5;  
  }  
}  
  
function isStrictlyDescendingDistinct(rs: Rank[]): boolean {  
  for (let i = 0; i < rs.length; i++) {  
    if (i > 0 && !(rs[i-1] > rs[i])) return false;  
  }  
  return new Set(rs).size === rs.length;  
}  
  
export function normalizeCall(c: Call): Call {  
  if (c.kind === "TWO_PAIR") {  
    const high = Math.max(c.high, c.low) as Rank;  
    const low = Math.min(c.high, c.low) as Rank;  
    return { ...c, high, low };  
  }  
  if (c.kind === "SINGLE" || c.kind === "PAIR" || c.kind === "TRIPS") {  
    const kickers = c.kickers.slice().sort((a,b)=>b-a);  
    return { ...c, kickers } as any;  
  }  
  return c;  
}  
  
export function isStructurallyValidCall(c0: Call): { ok: true } | { ok: false; error: string } {  
  const c = normalizeCall(c0);  
  const fail = (error: string) => ({ ok: false as const, error });  
  const slots = kickerSlots(c.kind);  
  
  if (c.kind === "SINGLE") {  
    if (c.kickers.length > slots) return fail("Too many kickers.");  
    if (c.kickers.includes(c.rank)) return fail("Kickers must differ from main rank.");  
    if (!isStrictlyDescendingDistinct(c.kickers)) return fail("Kickers must be distinct and descending.");  
    if (c.kickers.some(k => k >= c.rank)) return fail("High-card kickers must be lower than the top card.");  
    return { ok: true };  
  }  
  
  if (c.kind === "PAIR") {  
    if (c.kickers.length > slots) return fail("Too many kickers.");  
    if (c.kickers.includes(c.rank)) return fail("Kickers must differ from pair rank.");  
    if (!isStrictlyDescendingDistinct(c.kickers)) return fail("Kickers must be distinct and descending.");  
    return { ok: true };  
  }  
  
  if (c.kind === "TRIPS") {  
    if (c.kickers.length > slots) return fail("Too many kickers.");  
    if (c.kickers.includes(c.rank)) return fail("Kickers must differ from trips rank.");  
    if (!isStrictlyDescendingDistinct(c.kickers)) return fail("Kickers must be distinct and descending.");  
    return { ok: true };  
  }  
  
  if (c.kind === "QUADS") {  
    if (c.kicker === c.rank) return fail("Kicker must differ from quad rank.");  
    return { ok: true };  
  }  
  
  if (c.kind === "TWO_PAIR") {  
    if (c.high === c.low) return fail("Two pair ranks must differ.");  
    if (c.kicker && (c.kicker === c.high || c.kicker === c.low)) return fail("Kicker must differ from pair ranks.");  
    return { ok: true };  
  }  
  
  if (c.kind === "FULL_HOUSE") {  
    if (c.trips === c.pair) return fail("Trips and pair ranks must differ.");  
    return { ok: true };  
  }  
  
  return fail("Unknown call.");  
}  
  
/**  
 * Total ordering for raising:  
 * - kind strength (SINGLE < PAIR < TWO_PAIR < TRIPS < FULL_HOUSE < QUADS)  
 * - main ranks (poker-style)  
 * - ordered kickers (missing treated as -1)  
 * - if still tied, more specific is higher  
 */  
export function compareCalls(a0: Call, b0: Call): number {  
  const a = normalizeCall(a0);  
  const b = normalizeCall(b0);  
  
  const ko = kindOrder(a.kind) - kindOrder(b.kind);  
  if (ko !== 0) return ko;  
  
  const vecA = primaryVec(a);  
  const vecB = primaryVec(b);  
  for (let i = 0; i < Math.max(vecA.length, vecB.length); i++) {  
    const va = vecA[i] ?? -1;  
    const vb = vecB[i] ?? -1;  
    if (va !== vb) return va - vb;  
  }  
  
  const kA = kickerVec(a);  
  const kB = kickerVec(b);  
  for (let i = 0; i < Math.max(kA.length, kB.length); i++) {  
    const va = kA[i] ?? -1;  
    const vb = kB[i] ?? -1;  
    if (va !== vb) return va - vb;  
  }  
  
  return specificity(a) - specificity(b);  
}  
  
function primaryVec(c: Call): number[] {  
  switch (c.kind) {  
    case "SINGLE": return [c.rank];  
    case "PAIR": return [c.rank];  
    case "TRIPS": return [c.rank];  
    case "QUADS": return [c.rank];  
    case "TWO_PAIR": return [c.high, c.low];  
    case "FULL_HOUSE": return [c.trips, c.pair];  
  }  
}  
  
function kickerVec(c: Call): number[] {  
  const slots = kickerSlots(c.kind);  
  if (slots === 0) return [];  
  switch (c.kind) {  
    case "SINGLE":  
    case "PAIR":  
    case "TRIPS": {  
      const ks = c.kickers.slice().sort((x,y)=>y-x);  
      return ks.concat(Array(slots - ks.length).fill(-1));  
    }  
    case "TWO_PAIR":  
      return [c.kicker ?? -1];  
    case "QUADS":  
      return [c.kicker ?? -1];  
    case "FULL_HOUSE":  
      return [];  
  }  
}  
  
function specificity(c: Call): number {  
  switch (c.kind) {  
    case "SINGLE":  
    case "PAIR":  
    case "TRIPS":  
      return c.kickers.length;  
    case "TWO_PAIR":  
      return c.kicker ? 1 : 0;  
    case "QUADS":  
      return c.kicker ? 1 : 0;  
    case "FULL_HOUSE":  
      return 0;  
  }  
}  
  
/**  
 * “Kicker version” truth check (no straights/flushes):  
 * The call is satisfied if there exists SOME 5-card poker hand of the called rank  
 * matching the specified main rank(s) and specified kickers-as-top-kickers ordering.  
 * (Unspecified kicker slots are “wildcards”, but must be lower than the last specified kicker.)  
 */  
export function isCallSatisfied(call0: Call, allCards: Card[]): boolean {  
  const call = normalizeCall(call0);  
  
  const counts = new Map<Rank, number>();  
  for (const c of allCards) counts.set(c.rank, (counts.get(c.rank) ?? 0) + 1);  
  
  const hasAtLeast = (r: Rank, n: number) => (counts.get(r) ?? 0) >= n;  
  const has1 = (r: Rank) => hasAtLeast(r, 1);  
  
  switch (call.kind) {  
    case "FULL_HOUSE":  
      return call.trips !== call.pair && hasAtLeast(call.trips, 3) && hasAtLeast(call.pair, 2);  
  
    case "QUADS": {  
      if (!hasAtLeast(call.rank, 4)) return false;  
      if (call.kicker) return call.kicker !== call.rank && has1(call.kicker);  
      return true;
    }  
  
    case "TWO_PAIR": {  
      if (call.high === call.low) return false;  
      if (!hasAtLeast(call.high, 2)) return false;  
      if (!hasAtLeast(call.low, 2)) return false;  
      if (call.kicker) return call.kicker !== call.high && call.kicker !== call.low && has1(call.kicker);  
      return true;
    }  
  
    case "TRIPS": {  
      if (!hasAtLeast(call.rank, 3)) return false;  
      for (const k of call.kickers) {
        if (k === call.rank) return false;
        if (!has1(k)) return false;
      }
      return true;
    }  
  
    case "PAIR": {  
      if (!hasAtLeast(call.rank, 2)) return false;  
      for (const k of call.kickers) {
        if (k === call.rank) return false;
        if (!has1(k)) return false;
      }
      return true;
    }  
  
    case "SINGLE": {  
      // high-card: the rank must exist among all dealt cards;
      // specified kickers (if any) must also exist and be < top rank
      if (!has1(call.rank)) return false;
      for (const k of call.kickers) {
        if (k >= call.rank) return false;
        if (!has1(k)) return false;
      }
      return true;
    }
  }
}
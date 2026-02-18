import type { Call, Rank } from "./types";  
import { RANKS_DESC, compareCalls } from "./calls";  
  
function combinations<T>(arr: T[], k: number, start = 0, prefix: T[] = [], out: T[][] = []): T[][] {  
  if (prefix.length === k) { out.push(prefix.slice()); return out; }  
  for (let i = start; i < arr.length; i++) {  
    prefix.push(arr[i]);  
    combinations(arr, k, i + 1, prefix, out);  
    prefix.pop();  
  }  
  return out;  
}  
  
export function generateAllCallsSorted(): Call[] {  
  const calls: Call[] = [];  
  const ranks = RANKS_DESC.slice().reverse() as Rank[]; // ascending 2..A for easier bounds sometimes  
  
  // SINGLE (high card): kickers must be < top rank  
  for (const top of RANKS_DESC) {  
    const lower = RANKS_DESC.filter(r => r < top);  
    for (let k = 0; k <= 4; k++) {  
      for (const comb of combinations(lower, k)) {  
        const kickers = comb.slice().sort((a,b)=>b-a);  
        calls.push({ kind: "SINGLE", rank: top, kickers });  
      }  
    }  
  }  
  
  // PAIR  
  for (const p of RANKS_DESC) {  
    const others = RANKS_DESC.filter(r => r !== p);  
    for (let k = 0; k <= 3; k++) {  
      for (const comb of combinations(others, k)) {  
        const kickers = comb.slice().sort((a,b)=>b-a);  
        calls.push({ kind: "PAIR", rank: p, kickers });  
      }  
    }  
  }  
  
  // TWO_PAIR  
  for (let i = 0; i < ranks.length; i++) {  
    for (let j = i + 1; j < ranks.length; j++) {  
      const a = ranks[i], b = ranks[j];  
      const high = Math.max(a,b) as Rank;  
      const low = Math.min(a,b) as Rank;  
      calls.push({ kind: "TWO_PAIR", high, low });  
      for (const k of RANKS_DESC) {  
        if (k === high || k === low) continue;  
        calls.push({ kind: "TWO_PAIR", high, low, kicker: k });  
      }  
    }  
  }  
  
  // TRIPS  
  for (const t of RANKS_DESC) {  
    const others = RANKS_DESC.filter(r => r !== t);  
    for (let k = 0; k <= 2; k++) {  
      for (const comb of combinations(others, k)) {  
        const kickers = comb.slice().sort((a,b)=>b-a);  
        calls.push({ kind: "TRIPS", rank: t, kickers });  
      }  
    }  
  }  
  
  // FULL_HOUSE  
  for (const t of RANKS_DESC) {  
    for (const p of RANKS_DESC) {  
      if (p === t) continue;  
      calls.push({ kind: "FULL_HOUSE", trips: t, pair: p });  
    }  
  }  
  
  // QUADS  
  for (const q of RANKS_DESC) {  
    calls.push({ kind: "QUADS", rank: q });  
    for (const k of RANKS_DESC) {  
      if (k === q) continue;  
      calls.push({ kind: "QUADS", rank: q, kicker: k });  
    }  
  }  
  
  calls.sort((a,b) => compareCalls(a,b));  
  return calls;  
}  
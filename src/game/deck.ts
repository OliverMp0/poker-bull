import type { Card, Rank, Suit } from "./types";  
  
export function makeDeck(): Card[] {  
  const suits: Suit[] = ["C", "D", "H", "S"];  
  const ranks: Rank[] = [2,3,4,5,6,7,8,9,10,11,12,13,14];  
  const deck: Card[] = [];  
  for (const s of suits) for (const r of ranks) deck.push({ rank: r, suit: s });  
  return deck;  
}  
  
// deterministic-ish PRNG for reproducible shuffle  
function mulberry32(seed: number) {  
  return function () {  
    let t = seed += 0x6D2B79F5;  
    t = Math.imul(t ^ (t >>> 15), t | 1);  
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);  
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;  
  };  
}  
  
export function shuffle<T>(arr: T[], seed: number): T[] {  
  const a = arr.slice();  
  const rand = mulberry32(seed);  
  for (let i = a.length - 1; i > 0; i--) {  
    const j = Math.floor(rand() * (i + 1));  
    [a[i], a[j]] = [a[j], a[i]];  
  }  
  return a;  
}  

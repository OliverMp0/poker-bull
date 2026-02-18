import type { Call, GameState, Player, Rank, RoundState } from "./types";  
import { makeDeck, shuffle } from "./deck";  
import { callToString, compareCalls, isCallSatisfied, isStructurallyValidCall } from "./calls";  
  
export function createPlayers(playerCount: number): Player[] {  
  const ps: Player[] = [];  
  ps.push({ id: "You", isHuman: true, losses: 0, eliminated: false, hand: [] });  
  for (let i = 1; i < playerCount; i++) {  
    ps.push({ id: `Bot ${i}`, isHuman: false, losses: 0, eliminated: false, hand: [] });  
  }  
  return ps;  
}  
  
export function activeIndices(players: Player[]): number[] {  
  const out: number[] = [];  
  for (let i = 0; i < players.length; i++) if (!players[i].eliminated) out.push(i);  
  return out;  
}  
  
export function nextActiveIndex(players: Player[], fromIndex: number): number {  
  const n = players.length;  
  for (let step = 1; step <= n; step++) {  
    const j = (fromIndex + step) % n;  
    if (!players[j].eliminated) return j;  
  }  
  return fromIndex;  
}  
  
export function countActive(players: Player[]): number {  
  return players.reduce((a,p)=>a + (!p.eliminated ? 1 : 0), 0);  
}  
  
export function handSizeForLosses(losses: number): number {  
  return Math.min(losses + 1, 5);  
}  
  
export function newGame(playerCount: number, seed = Date.now()): GameState {  
  const players = createPlayers(playerCount);  
  const round: RoundState = {  
    deckSeed: seed,  
    dealerIndex: 0,  
    turnIndex: 0,  
    lastCall: null,  
    lastCallerIndex: null,  
    history: [],  
    reveal: null  
  };  
  const gs: GameState = { players, round, gameOverWinnerIndex: null };  
  startRound(gs, seed);  
  return gs;  
}  

export function startRound(gs: GameState, seed = Date.now()): void {  
  gs.round.deckSeed = seed;  
  gs.round.lastCall = null;  
  gs.round.lastCallerIndex = null;  
  gs.round.history = [];  
  gs.round.reveal = null;  
  
  for (const p of gs.players) p.hand = [];  
  
  const act = activeIndices(gs.players);  
  
  const deck = shuffle(makeDeck(), seed);  
  let di = 0;  
  
  for (const idx of act) {  
    const p = gs.players[idx];  
    const n = handSizeForLosses(p.losses);  
    p.hand = deck.slice(di, di + n);  
    di += n;  
  }  
  
  if (gs.players[gs.round.dealerIndex].eliminated) {  
    gs.round.dealerIndex = act[0] ?? 0;  
  }  
  gs.round.turnIndex = gs.round.dealerIndex;  
  
  gs.round.history.push(`--- New round (dealer: ${gs.players[gs.round.dealerIndex].id}) ---`);  
  checkGameOver(gs);  
}  
  
export function resolveRevealAndNextRound(gs: GameState): void {  
  if (!gs.round.reveal) return;  
  const loserIndex = gs.round.reveal.loserIndex;  
  const loser = gs.players[loserIndex];  
  
  const loserHandSize = loser.hand.length; // use actual dealt size  
  
  loser.losses += 1;  
  const eliminatedNow = (loserHandSize >= 5);  
  if (eliminatedNow) {  
    loser.eliminated = true;  
    gs.round.history.push(`${loser.id} lost with 5 cards and is ELIMINATED.`);  
  } else {  
    gs.round.history.push(`${loser.id} loses this round (losses: ${loser.losses}).`);  
  }  
  
  if (!eliminatedNow) {  
    gs.round.dealerIndex = loserIndex;  
  } else {  
    gs.round.dealerIndex = nextActiveIndex(gs.players, loserIndex);  
  }  
  
  checkGameOver(gs);  
  if (gs.gameOverWinnerIndex !== null) return;  
  
  startRound(gs, Date.now());  
}  
  
export function canRaise(gs: GameState, call: Call): { ok: true } | { ok: false; error: string } {  
  const v = isStructurallyValidCall(call);  
  if (!v.ok) return v;  
  
  if (!gs.round.lastCall) return { ok: true };  
  if (compareCalls(gs.round.lastCall, call) >= 0) {  
    return { ok: false, error: "Call must be strictly higher than the last call." };  
  }  
  return { ok: true };  
}  
  
export function doRaise(gs: GameState, playerIndex: number, call: Call): { ok: true } | { ok: false; error: string } {  
  if (gs.gameOverWinnerIndex !== null) return { ok: false, error: "Game is over." };  
  if (gs.round.reveal) return { ok: false, error: "Round is resolving." };  
  if (gs.round.turnIndex !== playerIndex) return { ok: false, error: "Not your turn." };  
  if (gs.players[playerIndex].eliminated) return { ok: false, error: "Player eliminated." };  
  
  const ok = canRaise(gs, call);  
  if (!ok.ok) return ok;  
  
  gs.round.lastCall = call;  
  gs.round.lastCallerIndex = playerIndex;  
  gs.round.history.push(`${gs.players[playerIndex].id}: ${callToString(call)}`);  
  
  gs.round.turnIndex = nextActiveIndex(gs.players, playerIndex);  
  return { ok: true };  
}  
  
export function doChallenge(gs: GameState, challengerIndex: number): { ok: true } | { ok: false; error: string } {  
  if (gs.gameOverWinnerIndex !== null) return { ok: false, error: "Game is over." };  
  if (gs.round.reveal) return { ok: false, error: "Round is resolving." };  
  if (gs.round.turnIndex !== challengerIndex) return { ok: false, error: "Not your turn." };  
  if (!gs.round.lastCall || gs.round.lastCallerIndex === null) {  
    return { ok: false, error: "Nothing to challenge yet." };  
  }  
  
  const allCards = activeIndices(gs.players).flatMap(i => gs.players[i].hand);  
  const satisfied = isCallSatisfied(gs.round.lastCall, allCards);  
  
  const loserIndex = satisfied ? challengerIndex : gs.round.lastCallerIndex;  
  gs.round.reveal = { allCards, satisfied, loserIndex };  
  
  gs.round.history.push(  
    `${gs.players[challengerIndex].id} challenges ${gs.players[gs.round.lastCallerIndex].id} -> ` +  
    (satisfied ? `CALL TRUE` : `CALL FALSE`)  
  );  
  return { ok: true };  
}  

  
function checkGameOver(gs: GameState): void {  
  const act = activeIndices(gs.players);  
  if (act.length === 1) gs.gameOverWinnerIndex = act[0];  
}  
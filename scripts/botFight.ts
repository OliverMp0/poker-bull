/**
 * Head-to-head simulator: pits the "simple" bot vs the "hard" (MCCFR) bot.
 *
 * Run with:   npx tsx scripts/botFight.ts [games] [playerCount] [hardSeats...]
 *   e.g.      npx tsx scripts/botFight.ts 200 4 0
 *
 * Default: 200 games, 4 players, seat 0 = hard bot, rest = simple bot.
 */

import { newGame, doRaise, doChallenge, resolveRevealAndNextRound } from "../src/game/engine";
import { generateAllCallsSorted } from "../src/game/allCalls";
import { chooseBotAction } from "../src/bot/simpleBot";
import { chooseHardBotAction } from "../src/bot/hardBot";
import type { GameState } from "../src/game/types";

const allCallsSorted = generateAllCallsSorted();

type BotKind = "simple" | "hard";

function playOne(playerCount: number, kinds: BotKind[], seed: number): { winner: number; turns: number } {
  const gs = newGame(playerCount, seed);
  // Force all seats to be bots (override the "You" human flag).
  for (const p of gs.players) p.isHuman = false;

  let turns = 0;
  const maxTurns = 5000;

  while (gs.gameOverWinnerIndex === null && turns < maxTurns) {
    if (gs.round.reveal) { resolveRevealAndNextRound(gs); continue; }

    const ti = gs.round.turnIndex;
    const kind = kinds[ti];
    const action = kind === "hard"
      ? chooseHardBotAction(gs, ti, allCallsSorted)
      : chooseBotAction(gs, ti, allCallsSorted);

    if (action.type === "CHALLENGE") {
      const r = doChallenge(gs, ti);
      if (!r.ok) {
        // Shouldn't happen unless no lastCall; force a raise instead.
        forceRaise(gs, ti);
      }
    } else {
      const r = doRaise(gs, ti, action.call);
      if (!r.ok) forceRaise(gs, ti);
    }
    turns++;
  }

  return { winner: gs.gameOverWinnerIndex ?? -1, turns };
}

function forceRaise(gs: GameState, ti: number) {
  // Fallback: pick the first legal raise.
  for (const c of allCallsSorted) {
    const ok = doRaise(gs, ti, c);
    if (ok.ok) return;
  }
}

function main() {
  const argv = process.argv.slice(2);
  const games = parseInt(argv[0] ?? "200", 10);
  const playerCount = parseInt(argv[1] ?? "4", 10);
  const hardSeats = new Set<number>(
    (argv.slice(2).length > 0 ? argv.slice(2) : ["0"]).map(s => parseInt(s, 10))
  );

  const kinds: BotKind[] = [];
  for (let i = 0; i < playerCount; i++) kinds.push(hardSeats.has(i) ? "hard" : "simple");

  console.log(`Running ${games} games, ${playerCount} players. Seats:`,
    kinds.map((k, i) => `${i}:${k}`).join(" "));

  const wins = new Array<number>(playerCount).fill(0);
  let totalTurns = 0;
  const t0 = Date.now();

  for (let g = 0; g < games; g++) {
    const { winner, turns } = playOne(playerCount, kinds, 0xC0FFEE + g * 1009);
    if (winner >= 0) wins[winner]++;
    totalTurns += turns;
    if ((g + 1) % Math.max(1, Math.floor(games / 10)) === 0) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      process.stdout.write(`  ${g + 1}/${games}  (${elapsed}s)\r`);
    }
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\nDone in ${elapsed}s, avg ${(totalTurns / games).toFixed(1)} turns/game.\n`);

  let hardWins = 0, simpleWins = 0;
  let hardSeatsCount = 0, simpleSeatsCount = 0;
  for (let i = 0; i < playerCount; i++) {
    const pct = ((wins[i] / games) * 100).toFixed(1);
    console.log(`  seat ${i} (${kinds[i]}):  ${wins[i]}/${games}  (${pct}%)`);
    if (kinds[i] === "hard") { hardWins += wins[i]; hardSeatsCount++; }
    else { simpleWins += wins[i]; simpleSeatsCount++; }
  }
  const hardAvg = hardSeatsCount ? (hardWins / hardSeatsCount / games) * 100 : 0;
  const simpleAvg = simpleSeatsCount ? (simpleWins / simpleSeatsCount / games) * 100 : 0;
  console.log(`\n  hard  avg win rate / seat: ${hardAvg.toFixed(1)}%`);
  console.log(`  simple avg win rate / seat: ${simpleAvg.toFixed(1)}%`);
  const fair = 100 / playerCount;
  console.log(`  (fair baseline if equal skill: ${fair.toFixed(1)}%)`);
}

main();

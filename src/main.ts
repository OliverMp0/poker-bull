import "./style.css";  
  
import type { Call, CallKind, GameState, Rank } from "./game/types";  
import { newGame, doRaise, doChallenge, resolveRevealAndNextRound, activeIndices } from "./game/engine";  
import { callToString, isStructurallyValidCall, RANKS_DESC } from "./game/calls";  
import { generateAllCallsSorted } from "./game/allCalls";  
import { chooseBotAction } from "./bot/simpleBot";  
import { TableView } from "./view/table";  
  
const allCallsSorted = generateAllCallsSorted();  
  
const canvas = document.getElementById("c") as HTMLCanvasElement;  
const view = new TableView(canvas);  
  
let gs: GameState | null = null;  
let botTimer: number | null = null;  
let pendingContinue: (() => void) | null = null;  
  
// HUD elements  
const turnEl = document.getElementById("turn")!;  
const dealerEl = document.getElementById("dealer")!;  
const lastCallEl = document.getElementById("lastCall")!;  
const yourHandEl = document.getElementById("yourHand")!;  
const botsEl = document.getElementById("bots")!;  
const historyEl = document.getElementById("history")!;  
  
const raiseBtn = document.getElementById("raiseBtn") as HTMLButtonElement;  
const challengeBtn = document.getElementById("challengeBtn") as HTMLButtonElement;  
  
// Start overlay  
const startOverlay = document.getElementById("startOverlay")!;  
const startBtn = document.getElementById("startBtn") as HTMLButtonElement;  
const playerCountSel = document.getElementById("playerCount") as HTMLSelectElement;  
  
// Raise modal  
const raiseModal = document.getElementById("raiseModal")!;  
const callTypeSel = document.getElementById("callType") as HTMLSelectElement;  
const p1Label = document.getElementById("p1Label")!;  
const p2Label = document.getElementById("p2Label")!;  
const p1Sel = document.getElementById("p1") as HTMLSelectElement;  
const p2Sel = document.getElementById("p2") as HTMLSelectElement;  
  
const k1Label = document.getElementById("k1Label")!;  
const k2Label = document.getElementById("k2Label")!;  
const k3Label = document.getElementById("k3Label")!;  
const k4Label = document.getElementById("k4Label")!;  
const k1Sel = document.getElementById("k1") as HTMLSelectElement;  
const k2Sel = document.getElementById("k2") as HTMLSelectElement;  
const k3Sel = document.getElementById("k3") as HTMLSelectElement;  
const k4Sel = document.getElementById("k4") as HTMLSelectElement;  
  
const cancelRaiseBtn = document.getElementById("cancelRaise") as HTMLButtonElement;  
const submitRaiseBtn = document.getElementById("submitRaise") as HTMLButtonElement;  
const raiseErrorEl = document.getElementById("raiseError")!;  
// Continue overlay  
const continueOverlay = document.getElementById("continueOverlay")!;

// Announcement element
const announcementEl = document.getElementById("announcement")!;
let announcementTimer: number | null = null;

// --- boot ---  
startBtn.onclick = () => {  
  const n = parseInt(playerCountSel.value, 10);  
  gs = newGame(n);  
  startOverlay.classList.add("hidden");  
  syncUI();  
  tickBots();  
};  
  
raiseBtn.onclick = () => openRaiseModal();  
challengeBtn.onclick = () => {  
  if (!gs) return;  
  const you = 0;  
  const r = doChallenge(gs, you);  
  if (!r.ok) return;  
  // reveal is now set; show state and single continue resolves the round
  syncUI();  
  showContinue(() => {
    if (!gs) return;
    resolveRevealAndNextRound(gs);
    syncUI();
    if (gs.gameOverWinnerIndex !== null) return;
    tickBots();
  });
};
  
continueOverlay.onclick = (e) => {
  e.stopPropagation();
  if (pendingContinue) {
    const fn = pendingContinue;
    pendingContinue = null;
    continueOverlay.classList.add("hidden");
    // restore action buttons
    const controls = document.getElementById("controls")!;
    controls.classList.remove("hidden");
    fn();
  }
};

cancelRaiseBtn.onclick = () => closeRaiseModal();  
submitRaiseBtn.onclick = () => {  
  if (!gs) return;  
  const you = 0;  
  const call = buildCallFromModal();  
  if (!call) return;  
  
  const r = doRaise(gs, you, call);  
  if (!r.ok) {  
    raiseErrorEl.textContent = r.error;  
    return;  
  }  
  closeRaiseModal();  
  syncUI();  
  tickBots();  
};  
  
callTypeSel.onchange = () => refreshRaiseModalFields();  
  
function animate() {  
  view.frame();  
  requestAnimationFrame(animate);  
}  
animate();  
  
// --- UI helpers ---  
function showContinue(fn: () => void) {  
  pendingContinue = fn;  
  continueOverlay.classList.remove("hidden");  
  // hide action buttons so they don't clip the continue hint
  const controls = document.getElementById("controls")!;
  controls.classList.add("hidden");
}  

function showAnnouncement(text: string, duration = 1200) {
  if (announcementTimer !== null) window.clearTimeout(announcementTimer);
  announcementEl.textContent = text;
  announcementEl.classList.add("visible");
  announcementTimer = window.setTimeout(() => {
    announcementEl.classList.remove("visible");
    announcementTimer = null;
  }, duration);
}

function syncUI() {  
  if (!gs) return;  
  
  view.setState(gs);  
  
  const turnP = gs.players[gs.round.turnIndex];  
  const dealerP = gs.players[gs.round.dealerIndex];  
  
  turnEl.textContent = turnP.id + (turnP.isHuman ? " (you)" : "");  
  dealerEl.textContent = dealerP.id;  
  lastCallEl.textContent = gs.round.lastCall ? callToString(gs.round.lastCall) : "(none)";  
  
  yourHandEl.textContent = gs.players[0].hand.map(cardText).join("  ");  
  
  const act = activeIndices(gs.players);  
  const lines: string[] = [];  
  for (const i of act) {  
    const p = gs.players[i];  
    if (p.isHuman) continue;  
    lines.push(`${p.id}: cards=${p.hand.length} losses=${p.losses}`);  
  }  
  botsEl.textContent = lines.join("\n");  
  
  historyEl.textContent = gs.round.history.slice(-40).join("\n");  
  historyEl.scrollTop = historyEl.scrollHeight;  
  
  const yourTurn = gs.round.turnIndex === 0 && !gs.round.reveal && gs.gameOverWinnerIndex === null;  
  raiseBtn.disabled = !yourTurn;  
  challengeBtn.disabled = !yourTurn || !gs.round.lastCall;  
  
  if (gs.gameOverWinnerIndex !== null) {  
    gs.round.history.push(`*** WINNER: ${gs.players[gs.gameOverWinnerIndex].id} ***`);  
    historyEl.textContent = gs.round.history.slice(-60).join("\n");  
    raiseBtn.disabled = true;  
    challengeBtn.disabled = true;  
  }  
}  
  
function cardText(c: { rank: Rank; suit: string }) {  
  const r = (c.rank === 14 ? "A" : c.rank === 13 ? "K" : c.rank === 12 ? "Q" : c.rank === 11 ? "J" : String(c.rank));  
  const s = c.suit === "S" ? "♠" : c.suit === "H" ? "♥" : c.suit === "D" ? "♦" : "♣";  
  return `${r}${s}`;  
}  
  
// --- bot loop + reveal handling ---  
function tickBots() {  
  if (!gs) return;  
  if (gs.gameOverWinnerIndex !== null) return;  
  if (gs.round.reveal) { handleRevealIfAny(); return; }  
  
  const ti = gs.round.turnIndex;  
  const p = gs.players[ti];  
  if (p.isHuman) {
    showAnnouncement("Your turn");
    return;
  }  
  
  // Schedule a single bot action after a short delay  
  if (botTimer !== null) window.clearTimeout(botTimer);  
  botTimer = window.setTimeout(() => {  
    if (!gs) return;  
    if (gs.gameOverWinnerIndex !== null) return;  
    if (gs.round.reveal) { handleRevealIfAny(); return; }  
  
    const ti = gs.round.turnIndex;  
    const p = gs.players[ti];  
    if (p.isHuman) {
      showAnnouncement("Your turn");
      return;
    }  
  
    const action = chooseBotAction(gs, ti, allCallsSorted);  
    if (action.type === "CHALLENGE") {  
      doChallenge(gs, ti);  
      showAnnouncement(`${p.id} challenges!`, 1800);
      syncUI();
      // Merge reveal into a single continue click
      showContinue(() => {
        if (!gs) return;
        resolveRevealAndNextRound(gs);
        syncUI();
        if (gs.gameOverWinnerIndex !== null) return;
        tickBots();
      });
    } else {  
      doRaise(gs, ti, action.call);  
      showAnnouncement(`${p.id}: ${callToString(action.call)}`, 1800);
      syncUI();
      showContinue(() => tickBots());
    }  
  }, 400);  
}  
  
function handleRevealIfAny() {  
  if (!gs) return;  
  if (!gs.round.reveal) return;  
  
  // Show the reveal state, then single click resolves and starts next round
  syncUI();  
  showContinue(() => {  
    if (!gs) return;  
    resolveRevealAndNextRound(gs);  
    syncUI();  
    if (gs.gameOverWinnerIndex !== null) return;  
    tickBots();  
  });  
}  
  
// --- raise modal ---  
function openRaiseModal() {  
  if (!gs) return;  
  raiseErrorEl.textContent = "";  
  
  // populate kinds  
  callTypeSel.innerHTML = "";  
  const kinds: CallKind[] = ["SINGLE", "PAIR", "TWO_PAIR", "TRIPS", "FULL_HOUSE", "QUADS"];  
  for (const k of kinds) {  
    const opt = document.createElement("option");  
    opt.value = k;  
    opt.textContent =  
      k === "SINGLE" ? "High card" :  
      k === "PAIR" ? "Pair" :  
      k === "TWO_PAIR" ? "Two pair" :  
      k === "TRIPS" ? "Trips" :  
      k === "FULL_HOUSE" ? "Full house" :  
      "Quads";  
    callTypeSel.appendChild(opt);  
  }  
  
  // rank options  
  const rankOpts = [...RANKS_DESC];  
  fillRankSelect(p1Sel, rankOpts, 14);  
  fillRankSelect(p2Sel, rankOpts, 13);  
  fillRankSelect(k1Sel, ["(none)", ...rankOpts] as any, "(none)" as any);  
  fillRankSelect(k2Sel, ["(none)", ...rankOpts] as any, "(none)" as any);  
  fillRankSelect(k3Sel, ["(none)", ...rankOpts] as any, "(none)" as any);  
  fillRankSelect(k4Sel, ["(none)", ...rankOpts] as any, "(none)" as any);  
  
  refreshRaiseModalFields();  
  raiseModal.classList.remove("hidden");  
}  
  
function closeRaiseModal() {  
  raiseModal.classList.add("hidden");  
}  
  
function refreshRaiseModalFields() {  
  const kind = callTypeSel.value as CallKind;  
  
  const showP2 = (kind === "TWO_PAIR" || kind === "FULL_HOUSE");  
  p2Label.classList.toggle("hidden", !showP2);  
  p2Sel.classList.toggle("hidden", !showP2);  
  
  const labels = kickerLabels(kind);  
  const kLabels = [k1Label, k2Label, k3Label, k4Label];  
  const kSels = [k1Sel, k2Sel, k3Sel, k4Sel];  
  
  for (let i = 0; i < 4; i++) {  
    const shouldShow = i < labels.length;  
    kLabels[i].classList.toggle("hidden", !shouldShow);  
    kSels[i].classList.toggle("hidden", !shouldShow);  
    kLabels[i].textContent = shouldShow ? labels[i] : "";  
    if (!shouldShow) kSels[i].value = "(none)";  
  }  
  
  // primary labels  
  if (kind === "SINGLE") {  
    p1Label.textContent = "Top card";  
    p2Label.textContent = "";  
  } else if (kind === "PAIR") {  
    p1Label.textContent = "Pair rank";  
  } else if (kind === "TRIPS") {  
    p1Label.textContent = "Trips rank";  
  } else if (kind === "QUADS") {  
    p1Label.textContent = "Quads rank";  
  } else if (kind === "TWO_PAIR") {  
    p1Label.textContent = "Pair A";  
    p2Label.textContent = "Pair B";  
  } else if (kind === "FULL_HOUSE") {  
    p1Label.textContent = "Trips rank";  
    p2Label.textContent = "Pair rank";  
  }  
  
  raiseErrorEl.textContent = "";  
}  
  
function kickerLabels(kind: CallKind): string[] {  
  switch (kind) {  
    case "SINGLE": return ["Kicker 1", "Kicker 2", "Kicker 3", "Kicker 4"];  
    case "PAIR": return ["Kicker 1", "Kicker 2", "Kicker 3"];  
    case "TRIPS": return ["Kicker 1", "Kicker 2"];  
    case "TWO_PAIR": return ["Kicker"];  
    case "QUADS": return ["Kicker"];  
    case "FULL_HOUSE": return [];  
  }  
}  
  
function fillRankSelect(sel: HTMLSelectElement, ranks: any[], defaultValue: any) {  
  sel.innerHTML = "";  
  for (const r of ranks) {  
    const opt = document.createElement("option");  
    opt.value = String(r);  
    opt.textContent = r === "(none)" ? "(none)" : rankName(parseInt(String(r), 10) as Rank);  
    sel.appendChild(opt);  
  }  
  sel.value = String(defaultValue);  
}  
  
function rankName(r: Rank): string {  
  if (r === 14) return "Ace";  
  if (r === 13) return "King";  
  if (r === 12) return "Queen";  
  if (r === 11) return "Jack";  
  return String(r);  
}  
  
function parseRankOrNone(v: string): Rank | null {  
  if (v === "(none)") return null;  
  return parseInt(v, 10) as Rank;  
}  
  
function buildCallFromModal(): Call | null {  
  const kind = callTypeSel.value as CallKind;  
  
  const r1 = parseInt(p1Sel.value, 10) as Rank;  
  const r2 = parseInt(p2Sel.value, 10) as Rank;  
  
  const ks = [k1Sel, k2Sel, k3Sel, k4Sel]  
    .map(s => parseRankOrNone(s.value))  
    .filter((x): x is Rank => x !== null);  
  
  let call: Call;  
  
  if (kind === "SINGLE") call = { kind, rank: r1, kickers: ks };  
  else if (kind === "PAIR") call = { kind, rank: r1, kickers: ks };  
  else if (kind === "TRIPS") call = { kind, rank: r1, kickers: ks };  
  else if (kind === "FULL_HOUSE") call = { kind, trips: r1, pair: r2 };  
  else if (kind === "QUADS") call = { kind, rank: r1, kicker: ks[0] };  
  else call = { kind, high: r1, low: r2, kicker: ks[0] };  
  
  const v = isStructurallyValidCall(call);  
  if (!v.ok) { raiseErrorEl.textContent = v.error; return null; }  
  
  // also check “strictly higher than last call”  
  if (gs) {  
    const cr = (awaitableCanRaise(gs, call));  
    if (cr !== true) { raiseErrorEl.textContent = cr; return null; }  
  }  
  
  return call;  
}  
  
function awaitableCanRaise(gs: GameState, call: Call): true | string {  
  // reuse engine rule without importing canRaise directly to keep this file simple  
  if (!gs.round.lastCall) return true;  
  // dynamic import avoided; minimal duplicate: use call ordering by lookup in allCallsSorted  
  // Instead of re-implement compareCalls here, we just try a dry-run raise using engine:  
  // (but engine returns error that includes "Not your turn" etc). We'll do a lightweight check:  
  // -> simplest: allow submit, engine will error; but better feedback:  
  // We'll approximate by checking indices in allCallsSorted (they are fully sorted).  
  const idx = (c: Call) => {  
    for (let i = 0; i < allCallsSorted.length; i++) {  
      // stringify match isn't safe; so we just use callToString rough? Not.  
      // We'll do a conservative fallback: if user submits a non-raise, engine will reject.  
      // Hence: return -1 and skip.  
      void c;  
      return -1;  
    }  
    return -1;  
  };  
  // keep it simple: let engine validate on submit; no extra check here.  
  return true;  
}
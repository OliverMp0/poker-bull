import "./style.css";  
  
import type { Call, CallKind, GameState, Rank } from "./game/types";  
import { newGame, doRaise, doChallenge, resolveRevealAndNextRound } from "./game/engine";  
import { callToString, isStructurallyValidCall, RANKS_DESC } from "./game/calls";  
import { generateAllCallsSorted } from "./game/allCalls";  
import { chooseBotAction } from "./bot/simpleBot";  
import { chooseHardBotAction } from "./bot/hardBot";
import { OnlineClient, OnlineHost, type ClientMessage, type OnlineAction, type ServerMessage } from "./online";
import { TableView } from "./view/table";  
  
const allCallsSorted = generateAllCallsSorted();  
  
const canvas = document.getElementById("c") as HTMLCanvasElement;  
const view = new TableView(canvas);  
  
let gs: GameState | null = null;  
let botTimer: number | null = null;  
let pendingContinue: (() => void) | null = null;  
let onlineHost: OnlineHost | null = null;
let onlineClient: OnlineClient | null = null;
let localPlayerIndex = 0;
let onlineGame = false;
let onlineStarted = false;
const onlineNames = new Map<string, string>();
const peerPlayerIndices = new Map<string, number>();
  
// HUD elements  
const turnEl = document.getElementById("turn")!;  
const dealerEl = document.getElementById("dealer")!;  
const lastCallEl = document.getElementById("lastCall")!;  
const historyEl = document.getElementById("history")!;  
  
const raiseBtn = document.getElementById("raiseBtn") as HTMLButtonElement;  
const challengeBtn = document.getElementById("challengeBtn") as HTMLButtonElement;  
  
// Start overlay  
const startOverlay = document.getElementById("startOverlay")!;  
const startBtn = document.getElementById("startBtn") as HTMLButtonElement;  
const playerCountSel = document.getElementById("playerCount") as HTMLSelectElement;  
const difficultySel = document.getElementById("difficulty") as HTMLSelectElement | null;
const gameModeSel = document.getElementById("gameMode") as HTMLSelectElement;
const localSetup = document.getElementById("localSetup")!;
const onlineSetup = document.getElementById("onlineSetup")!;
const playerNameInput = document.getElementById("playerName") as HTMLInputElement;
const roomCodeInput = document.getElementById("roomCode") as HTMLInputElement;
const hostBtn = document.getElementById("hostBtn") as HTMLButtonElement;
const joinBtn = document.getElementById("joinBtn") as HTMLButtonElement;
const startOnlineBtn = document.getElementById("startOnlineBtn") as HTMLButtonElement;
const onlineStatusEl = document.getElementById("onlineStatus")!;

type Difficulty = "normal" | "hard";
let difficulty: Difficulty = "normal";
  
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
gameModeSel.onchange = () => {
  const online = gameModeSel.value === "online";
  localSetup.classList.toggle("hidden", online);
  onlineSetup.classList.toggle("hidden", !online);
};

startBtn.onclick = () => {  
  const n = parseInt(playerCountSel.value, 10);  
  difficulty = (difficultySel?.value === "hard" ? "hard" : "normal") as Difficulty;
  gs = newGame(n);  
  startOverlay.classList.add("hidden");  
  syncUI();  
  tickBots();  
};  

hostBtn.onclick = () => hostOnlineRoom();
joinBtn.onclick = () => joinOnlineRoom();
startOnlineBtn.onclick = () => startHostedGame();
  
raiseBtn.onclick = () => openRaiseModal();  
challengeBtn.onclick = () => {  
  if (!gs) return;  
  if (onlineGame) {
    submitOnlineAction({ type: "CHALLENGE" });
    return;
  }
  const you = localPlayerIndex;  
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
  const you = localPlayerIndex;  
  const call = buildCallFromModal();  
  if (!call) return;  

  if (onlineGame) {
    closeRaiseModal();
    submitOnlineAction({ type: "RAISE", call });
    return;
  }
  
  const r = doRaise(gs, you, call);  
  if (r.ok === false) {  
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

// --- online multiplayer ---
function onlineName(): string {
  return playerNameInput.value.trim().slice(0, 20) || "Player";
}

function onlineCode(): string {
  const code = roomCodeInput.value.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
  roomCodeInput.value = code;
  return code;
}

function setOnlineSetupEnabled(enabled: boolean): void {
  hostBtn.disabled = !enabled;
  joinBtn.disabled = !enabled;
  roomCodeInput.disabled = !enabled;
  playerNameInput.disabled = !enabled;
}

async function hostOnlineRoom(): Promise<void> {
  const code = onlineCode();
  if (!code) {
    onlineStatusEl.textContent = "Enter a room code first.";
    return;
  }

  setOnlineSetupEnabled(false);
  onlineNames.clear();
  onlineNames.set("host", onlineName());
  onlineHost = new OnlineHost(code, handleHostMessage, handleHostConnectionsChanged);
  try {
    await onlineHost.ready();
    onlineGame = true;
    localPlayerIndex = 0;
    startOnlineBtn.classList.remove("hidden");
    updateHostLobby();
  } catch {
    onlineStatusEl.textContent = "That room code is unavailable. Try another.";
    onlineHost.close();
    onlineHost = null;
    setOnlineSetupEnabled(true);
  }
}

async function joinOnlineRoom(): Promise<void> {
  const code = onlineCode();
  if (!code) {
    onlineStatusEl.textContent = "Enter the host's room code first.";
    return;
  }

  setOnlineSetupEnabled(false);
  onlineClient = new OnlineClient(handleServerMessage);
  onlineStatusEl.textContent = "Connecting…";
  try {
    await onlineClient.connect(code, onlineName());
    onlineGame = true;
    onlineStatusEl.textContent = "Connected. Waiting for the host to start…";
  } catch {
    onlineStatusEl.textContent = "Could not join that room.";
    onlineClient.close();
    onlineClient = null;
    setOnlineSetupEnabled(true);
  }
}

function handleHostConnectionsChanged(): void {
  if (!onlineHost || onlineStarted) return;
  const connected = new Set(onlineHost.peerIds());
  for (const peerId of onlineNames.keys()) {
    if (peerId !== "host" && !connected.has(peerId)) onlineNames.delete(peerId);
  }
  updateHostLobby();
}

function handleHostMessage(peerId: string, message: ClientMessage): void {
  if (!onlineHost) return;
  if (message.type === "JOIN" && !onlineStarted) {
    onlineNames.set(peerId, message.name.trim().slice(0, 20) || "Player");
    updateHostLobby();
    return;
  }
  if (message.type === "ACTION" && onlineStarted) {
    const playerIndex = peerPlayerIndices.get(peerId);
    if (playerIndex !== undefined) applyHostedAction(playerIndex, message.action, peerId);
  }
}

function updateHostLobby(): void {
  if (!onlineHost) return;
  const players = [onlineNames.get("host")!, ...onlineHost.peerIds()
    .map(peerId => onlineNames.get(peerId))
    .filter((name): name is string => !!name)];
  onlineStatusEl.textContent = `Room ${onlineCode()} — ${players.length} player${players.length === 1 ? "" : "s"}: ${players.join(", ")}`;
  startOnlineBtn.disabled = players.length < 2;
  onlineHost.broadcast(() => ({ type: "LOBBY", players }));
}

function startHostedGame(): void {
  if (!onlineHost || onlineStarted) return;
  const peerIds = onlineHost.peerIds().filter(peerId => onlineNames.has(peerId));
  if (peerIds.length < 1) return;

  onlineStarted = true;
  peerPlayerIndices.clear();
  gs = newGame(peerIds.length + 1);
  gs.players[0].id = onlineNames.get("host")!;
  gs.players[0].isHuman = true;
  peerIds.forEach((peerId, offset) => {
    const playerIndex = offset + 1;
    peerPlayerIndices.set(peerId, playerIndex);
    gs!.players[playerIndex].id = onlineNames.get(peerId)!;
    gs!.players[playerIndex].isHuman = false;
    onlineHost!.send(peerId, { type: "START", playerIndex, state: stateForPlayer(playerIndex) });
  });

  startOverlay.classList.add("hidden");
  syncUI();
  broadcastOnlineState();
}

function handleServerMessage(message: ServerMessage): void {
  if (message.type === "LOBBY") {
    onlineStatusEl.textContent = `Waiting for host — players: ${message.players.join(", ")}`;
  } else if (message.type === "START") {
    localPlayerIndex = message.playerIndex;
    onlineStarted = true;
    gs = message.state;
    startOverlay.classList.add("hidden");
    syncUI();
  } else if (message.type === "STATE") {
    gs = message.state;
    syncUI();
    if (message.announcement) showAnnouncement(message.announcement, 1800);
  } else {
    showAnnouncement(message.message, 1800);
  }
}

function submitOnlineAction(action: OnlineAction): void {
  if (!gs || gs.round.turnIndex !== localPlayerIndex) return;
  if (onlineHost) applyHostedAction(localPlayerIndex, action);
  else onlineClient?.send({ type: "ACTION", action });
}

function applyHostedAction(playerIndex: number, action: OnlineAction, sourcePeerId?: string): void {
  if (!gs || !onlineHost) return;
  const result = action.type === "RAISE"
    ? doRaise(gs, playerIndex, action.call)
    : doChallenge(gs, playerIndex);
  if (result.ok === false) {
    if (sourcePeerId) onlineHost.send(sourcePeerId, { type: "ERROR", message: result.error });
    else showAnnouncement(result.error);
    return;
  }

  const announcement = action.type === "RAISE"
    ? `${gs.players[playerIndex].id}: ${callToString(action.call)}`
    : `${gs.players[playerIndex].id} calls bullshit!`;
  syncUI();
  broadcastOnlineState(announcement);
  showAnnouncement(announcement, 1800);

  if (action.type === "CHALLENGE") {
    window.setTimeout(() => {
      if (!gs?.round.reveal) return;
      resolveRevealAndNextRound(gs);
      syncUI();
      broadcastOnlineState();
    }, 2500);
  }
}

function stateForPlayer(playerIndex: number): GameState {
  if (!gs) throw new Error("Game has not started.");
  const state = structuredClone(gs);
  for (let i = 0; i < state.players.length; i++) {
    state.players[i].isHuman = i === playerIndex;
    if (i !== playerIndex && !state.round.reveal) {
      state.players[i].hand = state.players[i].hand.map(() => ({ rank: 2 as Rank, suit: "C" as const }));
    }
  }
  return state;
}

function broadcastOnlineState(announcement?: string): void {
  if (!onlineHost || !gs) return;
  onlineHost.broadcast(peerId => ({
    type: "STATE",
    state: stateForPlayer(peerPlayerIndices.get(peerId)!),
    announcement,
  }));
}
  
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
  
  historyEl.textContent = gs.round.history.slice(-40).join("\n");  
  historyEl.scrollTop = historyEl.scrollHeight;  
  
  const yourTurn = gs.round.turnIndex === localPlayerIndex && !gs.round.reveal && gs.gameOverWinnerIndex === null;  
  raiseBtn.disabled = !yourTurn;  
  challengeBtn.disabled = !yourTurn || !gs.round.lastCall;  
  
  if (gs.gameOverWinnerIndex !== null) {  
    gs.round.history.push(`*** WINNER: ${gs.players[gs.gameOverWinnerIndex].id} ***`);  
    historyEl.textContent = gs.round.history.slice(-60).join("\n");  
    raiseBtn.disabled = true;  
    challengeBtn.disabled = true;  
  }  
}  
  
// --- bot loop + reveal handling ---  
function tickBots() {  
  if (!gs) return;  
  if (onlineGame) return;
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
  
    const action = difficulty === "hard"
      ? chooseHardBotAction(gs, ti, allCallsSorted)
      : chooseBotAction(gs, ti, allCallsSorted);  
    if (action.type === "CHALLENGE") {  
      doChallenge(gs, ti);  
      showAnnouncement(`${p.id} calls bullshit!`, 1800);
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
  if (v.ok === false) { raiseErrorEl.textContent = v.error; return null; }  
  
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
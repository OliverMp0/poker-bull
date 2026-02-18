export type Suit = "C" | "D" | "H" | "S";  
export type Rank =  
  | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14; // 11 J,12 Q,13 K,14 A  
  
export type Card = { rank: Rank; suit: Suit };  
  
export type CallKind = "SINGLE" | "PAIR" | "TWO_PAIR" | "TRIPS" | "FULL_HOUSE" | "QUADS";  
  
/**  
 * Kicker-version calls:  
 * - Still validated by existence/counts in the combined dealt cards.  
 * - Kickers are ordered (highest kicker first), must be strictly descending and distinct.  
 * - More specific (more kickers) is higher when other comparisons tie.  
 */  
export type Call =  
  | { kind: "SINGLE"; rank: Rank; kickers: Rank[] } // up to 4 kickers  
  | { kind: "PAIR"; rank: Rank; kickers: Rank[] }   // up to 3 kickers  
  | { kind: "TWO_PAIR"; high: Rank; low: Rank; kicker?: Rank }  
  | { kind: "TRIPS"; rank: Rank; kickers: Rank[] }  // up to 2 kickers  
  | { kind: "FULL_HOUSE"; trips: Rank; pair: Rank }  
  | { kind: "QUADS"; rank: Rank; kicker?: Rank };  
  
export type Player = {  
  id: string;  
  isHuman: boolean;  
  losses: number;      // eliminated at 5th loss (i.e., loses with 5 cards)  
  eliminated: boolean;  
  hand: Card[];  
};  
  
export type RoundState = {  
  deckSeed: number;  
  dealerIndex: number;     // index into players array  
  turnIndex: number;       // current actor index  
  lastCall: Call | null;  
  lastCallerIndex: number | null;  
  history: string[];  
  reveal: { allCards: Card[]; satisfied: boolean; loserIndex: number } | null;  
};  
  
export type GameState = {  
  players: Player[];  
  round: RoundState;  
  gameOverWinnerIndex: number | null;  
};  
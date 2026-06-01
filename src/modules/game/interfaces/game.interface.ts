import { Player } from "./player.interface";

export interface ActiveGame {
  roomCode: string;
  status: "WAITING" | "PLAYING" | "FINISHED";
  players: Player[];
  currentTurnPlayerId?: string;
  selectedNumbers: Set<number>;
  winnerPlayerId?: string;
  timerExpiresAt?: number;
  pendingSelection?: {
    number: number;
    selectorPlayerId: string;
  };
  disconnectedUsername?: string;
  disconnectExpiresAt?: number;
  playAgainRequests?: string[];
}

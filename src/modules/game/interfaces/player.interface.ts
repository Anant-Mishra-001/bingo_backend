import { Board } from "./board.interface";

export interface Player {
  playerId: string;
  socketId: string;
  username: string;
  board?: Board; // Board can be optional before user submits
  completedLines: number;
  completedPatterns: Set<string>;
  isReady: boolean; // Tracking if board is submitted
}

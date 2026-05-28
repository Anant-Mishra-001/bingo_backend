import { Board } from "../interfaces/board.interface";

export function markNumber(board: Board, number: number): void {
  for (const row of board) {
    for (const cell of row) {
      if (cell.value === number) {
        cell.marked = true;
      }
    }
  }
}

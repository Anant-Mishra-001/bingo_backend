import { Board } from "../interfaces/board.interface";

export function calculateCompletedLines(
  board: Board,
  completedPatterns: Set<string>,
): number {
  let count = completedPatterns.size;

  // Rows
  for (let i = 0; i < 5; i++) {
    const key = `ROW_${i}`;
    if (!completedPatterns.has(key) && board[i].every(cell => cell.marked)) {
      completedPatterns.add(key);
      count++;
    }
  }

  // Columns
  for (let col = 0; col < 5; col++) {
    const key = `COL_${col}`;
    const completed = board.every(row => row[col].marked);
    if (completed && !completedPatterns.has(key)) {
      completedPatterns.add(key);
      count++;
    }
  }

  // Main diagonal
  const mainDiagonal = [0, 1, 2, 3, 4].every(i => board[i][i].marked);
  if (mainDiagonal && !completedPatterns.has("MAIN_DIAGONAL")) {
    completedPatterns.add("MAIN_DIAGONAL");
    count++;
  }

  // Secondary diagonal
  const secondaryDiagonal = [0, 1, 2, 3, 4].every(i => board[i][4 - i].marked);
  if (secondaryDiagonal && !completedPatterns.has("SECONDARY_DIAGONAL")) {
    completedPatterns.add("SECONDARY_DIAGONAL");
    count++;
  }

  return count;
}

export function validateBoard(board: number[][]): boolean {
  if (!board || board.length !== 5) {
    return false;
  }

  const nums = new Set<number>();
  for (const row of board) {
    if (!row || row.length !== 5) {
      return false;
    }
    for (const num of row) {
      if (typeof num !== 'number' || num < 1 || num > 25) {
        return false;
      }
      if (nums.has(num)) {
        return false;
      }
      nums.add(num);
    }
  }

  return nums.size === 25;
}

export interface Cell {
  value: number;
  marked: boolean;
  disabled?: boolean;
}

export type Board = Cell[][];

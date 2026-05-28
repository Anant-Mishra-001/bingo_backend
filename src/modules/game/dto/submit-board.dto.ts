import { IsArray, IsNotEmpty, IsString } from 'class-validator';

export class SubmitBoardDto {
  @IsString()
  @IsNotEmpty()
  roomCode!: string;

  @IsArray()
  @IsNotEmpty()
  board!: number[][];
}

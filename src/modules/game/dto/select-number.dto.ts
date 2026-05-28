import { IsInt, IsNotEmpty, IsString, Max, Min } from 'class-validator';

export class SelectNumberDto {
  @IsString()
  @IsNotEmpty()
  roomCode!: string;

  @IsInt()
  @Min(1)
  @Max(25)
  @IsNotEmpty()
  number!: number;
}

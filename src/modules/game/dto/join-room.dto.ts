import { IsNotEmpty, IsString } from 'class-validator';

export class JoinRoomDto {
  @IsString()
  @IsNotEmpty()
  roomCode!: string;

  @IsString()
  @IsNotEmpty()
  username!: string;
}

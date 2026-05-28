import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { GameGateway } from './gateway/game.gateway';
import { GameService } from './services/game.service';
import { BingoUser, BingoUserSchema } from './schemas/user.schema';
import { Game as GameSchemaClass, GameSchema } from './schemas/game.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: BingoUser.name, schema: BingoUserSchema },
      { name: GameSchemaClass.name, schema: GameSchema },
    ]),
  ],
  providers: [GameGateway, GameService],
  exports: [GameService],
})
export class GameModule {}

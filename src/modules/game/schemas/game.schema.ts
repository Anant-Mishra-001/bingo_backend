import {
  Prop,
  Schema,
  SchemaFactory,
} from "@nestjs/mongoose";
import { HydratedDocument } from "mongoose";

export type GameDocument = HydratedDocument<Game>;

@Schema({
  _id: false,
})
class Cell {
  @Prop()
  value!: number;

  @Prop({
    default: false,
  })
  marked!: boolean;
}

const CellSchema = SchemaFactory.createForClass(Cell);

@Schema({
  _id: false,
})
class Player {
  @Prop()
  playerId!: string;

  @Prop()
  username!: string;

  @Prop({
    default: 0,
  })
  completedLines!: number;

  @Prop([String])
  completedPatterns!: string[];

  @Prop({
    type: [[CellSchema]],
  })
  board!: Cell[][];
}

const PlayerSchema = SchemaFactory.createForClass(Player);

@Schema({
  _id: false,
})
class Move {
  @Prop()
  playerId!: string;

  @Prop()
  number!: number;

  @Prop({
    default: Date.now,
  })
  createdAt!: Date;
}

const MoveSchema = SchemaFactory.createForClass(Move);

@Schema({
  timestamps: true,
})
export class Game {
  @Prop({
    required: true,
    unique: true,
  })
  roomCode!: string;

  @Prop({
    enum: [
      "WAITING",
      "PLAYING",
      "FINISHED",
    ],
    default: "WAITING",
  })
  status!: string;

  @Prop()
  currentTurnPlayerId!: string;

  @Prop()
  winnerPlayerId?: string;

  @Prop([Number])
  selectedNumbers!: number[];

  @Prop({
    type: [PlayerSchema],
    default: [],
  })
  players!: Player[];

  @Prop({
    type: [MoveSchema],
    default: [],
  })
  moves!: Move[];

  @Prop()
  startedAt?: Date;

  @Prop()
  endedAt?: Date;
}

export const GameSchema = SchemaFactory.createForClass(Game);

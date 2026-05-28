import {
  Prop,
  Schema,
  SchemaFactory,
} from "@nestjs/mongoose";
import { HydratedDocument } from "mongoose";

export type BingoUserDocument = HydratedDocument<BingoUser>;

@Schema({
  timestamps: true,
})
export class BingoUser {
  @Prop({
    required: true,
    unique: true,
  })
  username!: string;

  @Prop({
    default: 0,
  })
  gamesPlayed!: number;

  @Prop({
    default: 0,
  })
  wins!: number;
}

export const BingoUserSchema = SchemaFactory.createForClass(BingoUser);

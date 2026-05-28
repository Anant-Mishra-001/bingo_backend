import { ActiveGame } from "../interfaces/game.interface";

export function switchTurn(game: ActiveGame): string {
  const currentTurn = game.currentTurnPlayerId;
  const nextPlayer = game.players.find(p => p.playerId !== currentTurn);
  return nextPlayer ? nextPlayer.playerId : game.players[0].playerId;
}

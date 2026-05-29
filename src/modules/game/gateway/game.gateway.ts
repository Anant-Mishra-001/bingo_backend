import {
  WebSocketGateway,
  SubscribeMessage,
  WebSocketServer,
  ConnectedSocket,
  MessageBody,
  OnGatewayDisconnect,
} from "@nestjs/websockets";
import { Server, Socket } from "socket.io";
import { GameService } from "../services/game.service";
import { CreateRoomDto } from "../dto/create-room.dto";
import { JoinRoomDto } from "../dto/join-room.dto";
import { SubmitBoardDto } from "../dto/submit-board.dto";
import { SelectNumberDto } from "../dto/select-number.dto";
import { SocketEvents } from "../constants/socket-events.constant";
import { ActiveGame } from "../interfaces/game.interface";
import { UsePipes, ValidationPipe, Logger } from "@nestjs/common";

@WebSocketGateway({
  cors: {
    origin: "*",
  },
})
export class GameGateway implements OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(GameGateway.name);


  constructor(private readonly gameService: GameService) {
    this.gameService.onGameUpdated = (roomCode: string, game: ActiveGame) => {
      this.server.to(roomCode).emit(SocketEvents.GAME_UPDATED, this.serializeGame(game));
    };
    this.gameService.onGameOver = (roomCode: string, game: ActiveGame) => {
      this.server.to(roomCode).emit(SocketEvents.GAME_OVER, {
        winnerPlayerId: game.winnerPlayerId,
        game: this.serializeGame(game),
      });
      this.gameService.cleanGame(roomCode);
    };
  }

  async handleDisconnect(client: Socket) {
    this.logger.log(`Socket disconnected: ${client.id}`);
    const roomCode = await this.gameService.handlePlayerDisconnect(client.id);
    if (roomCode) {
      const game = this.gameService.getGame(roomCode);
      if (game) {
        this.server.to(roomCode).emit(SocketEvents.GAME_UPDATED, this.serializeGame(game));
      }
    }
  }



  @UsePipes(new ValidationPipe({ transform: true }))
  @SubscribeMessage(SocketEvents.CREATE_ROOM)
  async handleCreateRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: CreateRoomDto,
  ) {
    try {
      const game = await this.gameService.createRoom(payload.username, client.id);
      client.join(game.roomCode);

      client.emit(SocketEvents.ROOM_CREATED, { roomCode: game.roomCode });
      this.server.to(game.roomCode).emit(SocketEvents.GAME_UPDATED, this.serializeGame(game));
    } catch (err: any) {
      client.emit(SocketEvents.ERROR, { message: err.message || 'Error creating room' });
    }
  }

  @UsePipes(new ValidationPipe({ transform: true }))
  @SubscribeMessage(SocketEvents.JOIN_ROOM)
  async handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: JoinRoomDto,
  ) {
    try {
      const game = await this.gameService.joinRoom(payload.roomCode, payload.username, client.id);
      await client.join(game.roomCode);

      // Send to the joining client directly to guarantee receipt
      client.emit(SocketEvents.GAME_UPDATED, this.serializeGame(game));

      // Broadcast to other room members
      this.server.to(game.roomCode).emit(SocketEvents.PLAYER_JOINED, {
        username: payload.username,
        playerId: client.id,
      });
      this.server.to(game.roomCode).emit(SocketEvents.GAME_UPDATED, this.serializeGame(game));
    } catch (err: any) {
      client.emit(SocketEvents.ERROR, { message: err.message || 'Error joining room' });
    }
  }

  @UsePipes(new ValidationPipe({ transform: true }))
  @SubscribeMessage('RECONNECT_GAME')
  async handleReconnectGame(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { roomCode: string; username: string },
  ) {
    try {
      const game = await this.gameService.reconnectRoom(payload.roomCode, payload.username, client.id);
      await client.join(game.roomCode);

      // Send to the reconnected client directly to guarantee receipt
      client.emit(SocketEvents.GAME_UPDATED, this.serializeGame(game));

      // Broadcast update to the room
      this.server.to(game.roomCode).emit(SocketEvents.GAME_UPDATED, this.serializeGame(game));
    } catch (err: any) {
      client.emit(SocketEvents.ERROR, { message: err.message || 'Error reconnecting to room' });
    }
  }

  @SubscribeMessage(SocketEvents.SEND_CHAT)
  async handleSendChat(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { roomCode: string; message: string },
  ) {
    try {
      const game = this.gameService.getGame(payload.roomCode);
      if (!game) return;

      const player = game.players.find(p => p.socketId === client.id);
      if (!player) return;

      this.server.to(payload.roomCode).emit(SocketEvents.CHAT_RECEIVED, {
        username: player.username,
        message: payload.message,
        createdAt: new Date(),
        isEmoji: /^\p{Emoji}$/u.test(payload.message.trim()),
      });
    } catch (err: any) {
      client.emit(SocketEvents.ERROR, { message: err.message || 'Error sending chat' });
    }
  }

  @UsePipes(new ValidationPipe({ transform: true }))
  @SubscribeMessage(SocketEvents.SUBMIT_BOARD)
  async handleSubmitBoard(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: SubmitBoardDto,
  ) {
    try {
      const game = await this.gameService.submitBoard(payload.roomCode, client.id, payload.board);

      this.server.to(game.roomCode).emit(SocketEvents.GAME_UPDATED, this.serializeGame(game));

      if (game.status === 'PLAYING') {
        this.server.to(game.roomCode).emit(SocketEvents.GAME_STARTED, {
          currentTurnPlayerId: game.currentTurnPlayerId,
        });
      }
    } catch (err: any) {
      client.emit(SocketEvents.ERROR, { message: err.message || 'Error submitting board' });
    }
  }

  @UsePipes(new ValidationPipe({ transform: true }))
  @SubscribeMessage(SocketEvents.SELECT_NUMBER)
  async handleSelectNumber(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: SelectNumberDto,
  ) {
    try {
      const { game, lastMove } = await this.gameService.selectNumber(
        payload.roomCode,
        client.id,
        payload.number,
      );

      this.server.to(game.roomCode).emit(SocketEvents.NUMBER_SELECTED, {
        playerId: client.id,
        number: payload.number,
      });

      this.server.to(game.roomCode).emit(SocketEvents.GAME_UPDATED, this.serializeGame(game));

      if (game.status === 'FINISHED') {
        this.server.to(game.roomCode).emit(SocketEvents.GAME_OVER, {
          winnerPlayerId: game.winnerPlayerId,
          game: this.serializeGame(game),
        });
        // Remove game from memory
        this.gameService.cleanGame(game.roomCode);
      } else {
        this.server.to(game.roomCode).emit(SocketEvents.TURN_CHANGED, {
          currentTurnPlayerId: game.currentTurnPlayerId,
        });
      }
    } catch (err: any) {
      client.emit(SocketEvents.ERROR, { message: err.message || 'Error selecting number' });
    }
  }

  private serializeGame(game: ActiveGame) {
    return {
      roomCode: game.roomCode,
      status: game.status,
      currentTurnPlayerId: game.currentTurnPlayerId,
      winnerPlayerId: game.winnerPlayerId,
      selectedNumbers: Array.from(game.selectedNumbers),
      timerExpiresAt: game.timerExpiresAt,
      timerDurationRemaining: game.timerExpiresAt ? Math.max(0, Math.ceil((game.timerExpiresAt - Date.now()) / 1000)) : undefined,
      pendingSelection: game.pendingSelection,
      disconnectedUsername: game.disconnectedUsername,
      disconnectExpiresAt: game.disconnectExpiresAt,
      disconnectDurationRemaining: game.disconnectExpiresAt ? Math.max(0, Math.ceil((game.disconnectExpiresAt - Date.now()) / 1000)) : undefined,
      players: game.players.map(p => ({
        playerId: p.playerId,
        username: p.username,
        completedLines: p.completedLines,
        completedPatterns: Array.from(p.completedPatterns),
        isReady: p.isReady,
        // Optional: Hide other player's board values from client to prevent cheating
        board: p.board,
      })),
    };
  }
}

import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { activeGames } from '../game.state';
import { ActiveGame } from '../interfaces/game.interface';
import { Player } from '../interfaces/player.interface';
import { Cell } from '../interfaces/board.interface';
import { generateRoomCode } from '../engine/room.engine';
import { validateBoard } from '../validators/board.validator';
import { markNumber } from '../engine/board.engine';
import { calculateCompletedLines } from '../engine/line.engine';
import { checkWinner } from '../engine/winner.engine';
import { switchTurn } from '../engine/turn.engine';
import { BingoUser, BingoUserDocument } from '../schemas/user.schema';
import { Game as GameSchemaClass, GameDocument } from '../schemas/game.schema';

@Injectable()
export class GameService {
  public onGameUpdated?: (roomCode: string, game: ActiveGame) => void;
  public onGameOver?: (roomCode: string, game: ActiveGame) => void;
  private gameTimeouts = new Map<string, NodeJS.Timeout>();
  private disconnectTimeouts = new Map<string, NodeJS.Timeout>();

  constructor(
    @InjectModel(BingoUser.name) private readonly userModel: Model<BingoUserDocument>,
    @InjectModel(GameSchemaClass.name) private readonly gameModel: Model<GameDocument>,
  ) { }

  async createRoom(username: string, socketId: string): Promise<ActiveGame> {
    const roomCode = generateRoomCode();

    // Ensure user exists or create
    await this.getOrCreateUser(username);

    const host: Player = {
      playerId: socketId, // Simple playerId mapping to socketId for turn checking
      socketId,
      username,
      completedLines: 0,
      completedPatterns: new Set<string>(),
      isReady: false,
    };

    const game: ActiveGame = {
      roomCode,
      status: 'WAITING',
      players: [host],
      selectedNumbers: new Set<number>(),
    };

    activeGames.set(roomCode, game);
    return game;
  }

  async joinRoom(roomCode: string, username: string, socketId: string): Promise<ActiveGame> {
    const game = activeGames.get(roomCode);
    if (!game) {
      throw new NotFoundException('Room not found');
    }

    if (game.status !== 'WAITING') {
      throw new BadRequestException('Game has already started or finished');
    }

    if (game.players.length >= 2) {
      throw new BadRequestException('Room full');
    }

    // Ensure user exists or create
    await this.getOrCreateUser(username);

    // Prevent duplicate connection by same socket/user in same room
    const alreadyJoined = game.players.find(p => p.username === username);
    if (alreadyJoined) {
      throw new BadRequestException('User already joined this room');
    }

    const player: Player = {
      playerId: socketId,
      socketId,
      username,
      completedLines: 0,
      completedPatterns: new Set<string>(),
      isReady: false,
    };

    game.players.push(player);
    return game;
  }

  async submitBoard(roomCode: string, socketId: string, rawBoard: number[][]): Promise<ActiveGame> {
    const game = activeGames.get(roomCode);
    if (!game) {
      throw new NotFoundException('Room not found');
    }

    const player = game.players.find(p => p.socketId === socketId);
    if (!player) {
      throw new NotFoundException('Player not in this room');
    }

    if (player.isReady) {
      throw new BadRequestException('Board already submitted');
    }

    if (!validateBoard(rawBoard)) {
      throw new BadRequestException('Invalid 5x5 board layout');
    }

    // Convert raw number[][] to Cell[][]
    player.board = rawBoard.map(row =>
      row.map(num => ({ value: num, marked: false })),
    );
    player.isReady = true;

    // Check if both players are ready to start the game
    if (game.players.length === 2 && game.players.every(p => p.isReady)) {
      game.status = 'PLAYING';
      // Pick random player to start
      const randomIdx = Math.floor(Math.random() * 2);
      game.currentTurnPlayerId = game.players[randomIdx].playerId;
      this.startTurnTimer(roomCode);
    }

    return game;
  }

  async selectNumber(roomCode: string, socketId: string, num: number): Promise<{ game: ActiveGame; lastMove?: any }> {
    const game = activeGames.get(roomCode);
    if (!game) {
      throw new NotFoundException('Room not found');
    }

    if (game.status !== 'PLAYING') {
      throw new BadRequestException('Game is not in PLAYING state');
    }

    // Check if we are in PHASE_RESPONSE (waiting for opponent to respond/confirm a selected number)
    if (game.pendingSelection) {
      const targetNumber = game.pendingSelection.number;
      const selectorId = game.pendingSelection.selectorPlayerId;

      if (socketId === selectorId) {
        throw new BadRequestException('Wait for your opponent to mark the number');
      }

      if (num !== targetNumber) {
        throw new BadRequestException(`You must mark the number called by your opponent: ${targetNumber}`);
      }

      const player = game.players.find(p => p.playerId === socketId);
      if (!player || !player.board) {
        throw new BadRequestException('Player board not found');
      }

      // Mark the number on the responding player's board
      let marked = false;
      for (const row of player.board) {
        const cell = row.find(c => c.value === num);
        if (cell && !cell.marked && !cell.disabled) {
          cell.marked = true;
          marked = true;
          break;
        }
      }

      if (!marked) {
        throw new BadRequestException('Number already marked or disabled');
      }

      player.completedLines = calculateCompletedLines(player.board, player.completedPatterns);

      // Clear pendingSelection
      game.pendingSelection = undefined;

      // Check for winners
      const winners: Player[] = [];
      for (const p of game.players) {
        if (p.board) {
          p.completedLines = calculateCompletedLines(p.board, p.completedPatterns);
          if (checkWinner(p.completedLines)) {
            winners.push(p);
          }
        }
      }

      const lastMove = {
        playerId: socketId,
        number: num,
        createdAt: new Date(),
      };

      if (winners.length > 0) {
        this.clearTurnTimer(roomCode);
        game.status = 'FINISHED';
        let winnerId = winners[0].playerId;
        if (winners.length > 1) {
          if (winners[1].completedLines > winners[0].completedLines) {
            winnerId = winners[1].playerId;
          }
        }
        game.winnerPlayerId = winnerId;
        await this.saveFinishedGame(game, lastMove);
        if (this.onGameOver) {
          this.onGameOver(roomCode, game);
        }
      } else {
        // Switch turn to the responding player (they now get to select the next number)
        game.currentTurnPlayerId = socketId;
        this.startTurnTimer(roomCode);
      }

      return { game, lastMove };

    } else {
      // PHASE_SELECT: Current turn player selecting a number
      if (game.currentTurnPlayerId !== socketId) {
        throw new BadRequestException('It is not your turn');
      }

      if (game.selectedNumbers.has(num)) {
        throw new BadRequestException('Number already selected');
      }

      const player = game.players.find(p => p.playerId === socketId);
      if (!player || !player.board) {
        throw new BadRequestException('Player board not found');
      }

      // Check if number is disabled
      let allowed = false;
      for (const row of player.board) {
        const cell = row.find(c => c.value === num);
        if (cell && !cell.disabled && !cell.marked) {
          cell.marked = true;
          allowed = true;
          break;
        }
      }

      if (!allowed) {
        throw new BadRequestException('Number is marked or disabled');
      }

      game.selectedNumbers.add(num);
      player.completedLines = calculateCompletedLines(player.board, player.completedPatterns);

      const lastMove = {
        playerId: socketId,
        number: num,
        createdAt: new Date(),
      };

      // Check if current selector player won by selecting their own number
      const winners: Player[] = [];
      if (checkWinner(player.completedLines)) {
        winners.push(player);
      }

      if (winners.length > 0) {
        this.clearTurnTimer(roomCode);
        game.status = 'FINISHED';
        game.winnerPlayerId = winners[0].playerId;
        await this.saveFinishedGame(game, lastMove);
        if (this.onGameOver) {
          this.onGameOver(roomCode, game);
        }
      } else {
        // Transition to PHASE_RESPONSE for the opponent
        game.pendingSelection = {
          number: num,
          selectorPlayerId: socketId,
        };
        this.startTurnTimer(roomCode);
      }

      return { game, lastMove };
    }
  }

  private startTurnTimer(roomCode: string) {
    this.clearTurnTimer(roomCode);
    const game = activeGames.get(roomCode);
    if (!game || game.status !== 'PLAYING') return;

    game.timerExpiresAt = Date.now() + 30000;

    const timeout = setTimeout(() => {
      this.handleTimerExpired(roomCode);
    }, 30000);

    this.gameTimeouts.set(roomCode, timeout);
    
    if (this.onGameUpdated) {
      this.onGameUpdated(roomCode, game);
    }
  }

  private clearTurnTimer(roomCode: string) {
    const timeout = this.gameTimeouts.get(roomCode);
    if (timeout) {
      clearTimeout(timeout);
      this.gameTimeouts.delete(roomCode);
    }
  }

  private async handleTimerExpired(roomCode: string) {
    const game = activeGames.get(roomCode);
    if (!game || game.status !== 'PLAYING') return;

    if (game.pendingSelection) {
      // PHASE_RESPONSE timeout: Opponent missed selecting the called number
      const opponentId = game.players.find(p => p.playerId !== game.pendingSelection!.selectorPlayerId)?.playerId;
      if (opponentId) {
        const opponent = game.players.find(p => p.playerId === opponentId);
        if (opponent && opponent.board) {
          // Disable the cell containing the pending number on opponent's board
          const num = game.pendingSelection.number;
          for (const row of opponent.board) {
            const cell = row.find(c => c.value === num);
            if (cell) {
              cell.disabled = true;
            }
          }
        }
      }

      // Clear pending selection
      game.pendingSelection = undefined;

      // Recalculate completed lines and check for winners
      const winners: Player[] = [];
      for (const p of game.players) {
        if (p.board) {
          p.completedLines = calculateCompletedLines(p.board, p.completedPatterns);
          if (checkWinner(p.completedLines)) {
            winners.push(p);
          }
        }
      }

      if (winners.length > 0) {
        game.status = 'FINISHED';
        let winnerId = winners[0].playerId;
        if (winners.length > 1) {
          if (winners[1].completedLines > winners[0].completedLines) {
            winnerId = winners[1].playerId;
          }
        }
        game.winnerPlayerId = winnerId;
        
        await this.saveFinishedGame(game, {
          playerId: opponentId || '',
          number: -1,
          createdAt: new Date(),
        });

        if (this.onGameOver) {
          this.onGameOver(roomCode, game);
        }
      } else {
        // Switch turn to the opponent (the one who missed, since they now select a new number)
        game.currentTurnPlayerId = opponentId;
        this.startTurnTimer(roomCode);
      }
    } else {
      // PHASE_SELECT timeout: Active player missed selecting a number
      const activePlayer = game.players.find(p => p.playerId === game.currentTurnPlayerId);
      if (activePlayer && activePlayer.board) {
        // Pick a random unmarked and non-disabled cell on the active player's board
        const availableCells: number[] = [];
        for (const row of activePlayer.board) {
          for (const cell of row) {
            if (!cell.marked && !cell.disabled) {
              availableCells.push(cell.value);
            }
          }
        }

        if (availableCells.length > 0) {
          const randomNum = availableCells[Math.floor(Math.random() * availableCells.length)];
          // Mark number on active player's board
          for (const row of activePlayer.board) {
            const cell = row.find(c => c.value === randomNum);
            if (cell) cell.marked = true;
          }
          activePlayer.completedLines = calculateCompletedLines(activePlayer.board, activePlayer.completedPatterns);
          
          game.selectedNumbers.add(randomNum);

          const winners: Player[] = [];
          if (checkWinner(activePlayer.completedLines)) {
            winners.push(activePlayer);
          }

          if (winners.length > 0) {
            game.status = 'FINISHED';
            game.winnerPlayerId = winners[0].playerId;
            await this.saveFinishedGame(game, {
              playerId: activePlayer.playerId,
              number: randomNum,
              createdAt: new Date(),
            });

            if (this.onGameOver) {
              this.onGameOver(roomCode, game);
            }
          } else {
            // Transition to PHASE_RESPONSE for the opponent
            game.pendingSelection = {
              number: randomNum,
              selectorPlayerId: activePlayer.playerId,
            };
            this.startTurnTimer(roomCode);
          }
        } else {
          // No available numbers (highly unlikely)
          // Just switch turn
          game.currentTurnPlayerId = game.players.find(p => p.playerId !== game.currentTurnPlayerId)?.playerId;
          this.startTurnTimer(roomCode);
        }
      }
    }
  }

  getGame(roomCode: string): ActiveGame | undefined {
    return activeGames.get(roomCode);
  }

  cleanGame(roomCode: string): void {
    this.clearTurnTimer(roomCode);
    activeGames.delete(roomCode);
  }

  leaveRoom(roomCode: string, socketId: string): void {
    const game = activeGames.get(roomCode);
    if (!game) return;

    game.players = game.players.filter(p => p.socketId !== socketId);

    if (game.players.length === 0) {
      this.cleanGame(roomCode);
      return;
    }

    if (game.status === 'PLAYING') {
      const remainingPlayer = game.players[0];
      game.status = 'FINISHED';
      game.winnerPlayerId = remainingPlayer.playerId;
      this.clearTurnTimer(roomCode);
    } else if (game.status === 'FINISHED') {
      this.cleanGame(roomCode);
    }
  }

  async requestPlayAgain(roomCode: string, socketId: string): Promise<ActiveGame> {
    const game = activeGames.get(roomCode);
    if (!game) {
      throw new NotFoundException('Room not found');
    }

    if (game.status !== 'FINISHED') {
      throw new BadRequestException('Game is not finished yet');
    }

    const player = game.players.find(p => p.socketId === socketId);
    if (!player) {
      throw new NotFoundException('Player not in this room');
    }

    if (!game.playAgainRequests) {
      game.playAgainRequests = [];
    }

    if (!game.playAgainRequests.includes(socketId)) {
      game.playAgainRequests.push(socketId);
    }

    if (game.playAgainRequests.length === 2) {
      game.status = 'WAITING';
      game.selectedNumbers = new Set<number>();
      game.winnerPlayerId = undefined;
      game.timerExpiresAt = undefined;
      game.pendingSelection = undefined;
      game.playAgainRequests = [];

      for (const p of game.players) {
        p.board = undefined;
        p.isReady = false;
        p.completedLines = 0;
        p.completedPatterns = new Set<string>();
      }
    }

    return game;
  }

  async reconnectRoom(roomCode: string, username: string, newSocketId: string): Promise<ActiveGame> {
    const game = activeGames.get(roomCode);
    if (!game) {
      throw new NotFoundException('Room not found');
    }

    const player = game.players.find(p => p.username === username);
    if (!player) {
      throw new NotFoundException('Player not found in this room');
    }

    const oldPlayerId = player.playerId;

    // Clear disconnect timeout
    const disconnectTimeout = this.disconnectTimeouts.get(oldPlayerId);
    if (disconnectTimeout) {
      clearTimeout(disconnectTimeout);
      this.disconnectTimeouts.delete(oldPlayerId);
    }

    // Reset game disconnect flags
    game.disconnectedUsername = undefined;
    game.disconnectExpiresAt = undefined;

    // Update playerId and socketId to the new socket connection
    player.playerId = newSocketId;
    player.socketId = newSocketId;

    // Update turn pointer if it was this player's turn
    if (game.currentTurnPlayerId === oldPlayerId) {
      game.currentTurnPlayerId = newSocketId;
    }

    // Update pending selection selector if it was this player's selection
    if (game.pendingSelection && game.pendingSelection.selectorPlayerId === oldPlayerId) {
      game.pendingSelection.selectorPlayerId = newSocketId;
    }

    // Resume the game turn timer
    if (game.status === 'PLAYING') {
      this.startTurnTimer(roomCode);
    }

    return game;
  }

  async handlePlayerDisconnect(socketId: string): Promise<string | undefined> {
    // Find active game that contains this socketId
    let targetRoomCode: string | undefined = undefined;
    let targetGame: ActiveGame | undefined = undefined;

    for (const [code, game] of activeGames.entries()) {
      const hasPlayer = game.players.some(p => p.socketId === socketId);
      if (hasPlayer) {
        targetRoomCode = code;
        targetGame = game;
        break;
      }
    }

    if (!targetGame || !targetRoomCode) return undefined;
    if (targetGame.status === 'FINISHED') {
      const player = targetGame.players.find(p => p.socketId === socketId);
      if (player) {
        const existing = this.disconnectTimeouts.get(player.playerId);
        if (existing) clearTimeout(existing);

        const timeout = setTimeout(() => {
          this.disconnectTimeouts.delete(player.playerId);
          this.cleanGame(targetRoomCode!);
        }, 30000);

        this.disconnectTimeouts.set(player.playerId, timeout);
      }
      return targetRoomCode;
    }

    const player = targetGame.players.find(p => p.socketId === socketId);
    if (!player) return targetRoomCode;

    // Freeze turn timer
    this.clearTurnTimer(targetRoomCode);

    // Save disconnect properties
    targetGame.disconnectedUsername = player.username;
    targetGame.disconnectExpiresAt = Date.now() + 30000;

    const timeout = setTimeout(async () => {
      this.disconnectTimeouts.delete(player.playerId);

      // Verify the player is still disconnected
      if (targetGame!.disconnectedUsername === player.username) {
        const remainingPlayer = targetGame!.players.find(p => p.playerId !== player.playerId);
        if (remainingPlayer) {
          targetGame!.status = 'FINISHED';
          targetGame!.winnerPlayerId = remainingPlayer.playerId;
          targetGame!.disconnectedUsername = undefined;
          targetGame!.disconnectExpiresAt = undefined;

          await this.saveFinishedGame(targetGame!, {
            playerId: remainingPlayer.playerId,
            number: -1,
            createdAt: new Date(),
          });

          if (this.onGameOver) {
            this.onGameOver(targetRoomCode!, targetGame!);
          }
        }
      }
    }, 30000);

    this.disconnectTimeouts.set(player.playerId, timeout);
    return targetRoomCode;
  }

  private async getOrCreateUser(username: string): Promise<BingoUserDocument> {
    let user = await this.userModel.findOne({ username }).exec();
    if (!user) {
      user = new this.userModel({ username });
      await user.save();
    }
    return user;
  }

  private async saveFinishedGame(game: ActiveGame, lastMove: any): Promise<void> {
    try {
      // 1. Update stats for all players
      for (const p of game.players) {
        const isWinner = p.playerId === game.winnerPlayerId;
        await this.userModel.updateOne(
          { username: p.username },
          {
            $inc: {
              gamesPlayed: 1,
              wins: isWinner ? 1 : 0,
            },
          },
        ).exec();
      }

      // 2. Prepare players data for schema mapping
      const playersForDb = game.players.map(p => ({
        playerId: p.playerId,
        username: p.username,
        completedLines: p.completedLines,
        completedPatterns: Array.from(p.completedPatterns),
        board: p.board || [],
      }));

      // 3. Map moves (we can record selectNumbers as moves log)
      const movesForDb = Array.from(game.selectedNumbers).map((num, idx) => ({
        playerId: idx % 2 === 0 ? game.players[0].playerId : game.players[1].playerId, // Approximate player turn mapping
        number: num,
        createdAt: new Date(),
      }));

      // Update the last move to match the actual caller
      if (movesForDb.length > 0) {
        movesForDb[movesForDb.length - 1] = lastMove;
      }

      // 4. Save game history to database
      const gameHistory = new this.gameModel({
        roomCode: game.roomCode,
        status: 'FINISHED',
        currentTurnPlayerId: game.currentTurnPlayerId || '',
        winnerPlayerId: game.winnerPlayerId || '',
        selectedNumbers: Array.from(game.selectedNumbers),
        players: playersForDb,
        moves: movesForDb,
        startedAt: new Date(),
        endedAt: new Date(),
      });

      await gameHistory.save();
    } catch (err) {
      console.error('Error saving finished game status to DB:', err);
    }
  }
}

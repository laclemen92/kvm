/**
 * Example: Building a Leaderboard using KVM's Core Atomic Utilities
 * 
 * This example shows how to implement a gaming leaderboard with features like:
 * - Player score tracking
 * - Leaderboard rankings  
 * - Score updates and incrementing
 * - Top N players retrieval
 * 
 * This is built using KVM's core AtomicCounter and list operations.
 */

import { AtomicUtils } from "../lib/atomic-utils.ts";
import type { AtomicTransactionResult } from "../lib/atomic-types.ts";

export class AtomicLeaderboard {
  constructor(
    private kv: Deno.Kv,
    private gameId: string,
  ) {}

  /**
   * Update a player's score to a specific value
   */
  async updateScore(playerId: string, score: number | bigint): Promise<AtomicTransactionResult> {
    const counter = this.getPlayerCounter(playerId);
    return await counter.set(score);
  }

  /**
   * Increment a player's score by an amount
   */
  async incrementScore(playerId: string, amount: number | bigint = 1): Promise<AtomicTransactionResult> {
    const counter = this.getPlayerCounter(playerId);
    return await counter.increment(amount);
  }

  /**
   * Decrement a player's score by an amount
   */
  async decrementScore(playerId: string, amount: number | bigint = 1): Promise<AtomicTransactionResult> {
    const counter = this.getPlayerCounter(playerId);
    return await counter.decrement(amount);
  }

  /**
   * Get a player's current score
   */
  async getScore(playerId: string): Promise<bigint> {
    const counter = this.getPlayerCounter(playerId);
    return await counter.get();
  }

  /**
   * Reset a player's score to zero
   */
  async resetScore(playerId: string): Promise<AtomicTransactionResult> {
    const counter = this.getPlayerCounter(playerId);
    return await counter.reset();
  }

  /**
   * Get top N players with their scores
   * Note: This is a simplified implementation. For large leaderboards,
   * you'd want to implement proper indexing by score ranges.
   */
  async getTopPlayers(limit = 10): Promise<Array<{ playerId: string; score: bigint }>> {
    const players: Array<{ playerId: string; score: bigint }> = [];
    
    // List all player scores
    const prefix = this.getScoreKeyPrefix();
    for await (const entry of this.kv.list<Deno.KvU64>({ prefix })) {
      const playerId = entry.key[entry.key.length - 1] as string;
      const score = entry.value?.value ?? 0n;
      players.push({ playerId, score });
    }

    // Sort by score descending and take top N
    return players
      .sort((a, b) => Number(b.score - a.score))
      .slice(0, limit);
  }

  /**
   * Get a player's rank (1-based) among all players
   */
  async getPlayerRank(playerId: string): Promise<number> {
    const playerScore = await this.getScore(playerId);
    const topPlayers = await this.getTopPlayers(1000); // Get more players to find rank
    
    const rank = topPlayers.findIndex(p => p.playerId === playerId);
    return rank === -1 ? -1 : rank + 1; // 1-based ranking
  }

  /**
   * Get leaderboard statistics
   */
  async getStats(): Promise<{
    totalPlayers: number;
    highestScore: bigint;
    averageScore: number;
  }> {
    const players = await this.getTopPlayers(1000); // Get all players
    
    if (players.length === 0) {
      return { totalPlayers: 0, highestScore: 0n, averageScore: 0 };
    }

    const highestScore = players[0].score;
    const totalScore = players.reduce((sum, p) => sum + Number(p.score), 0);
    const averageScore = totalScore / players.length;

    return {
      totalPlayers: players.length,
      highestScore,
      averageScore,
    };
  }

  /**
   * Batch update multiple player scores atomically
   */
  async batchUpdateScores(updates: Array<{ playerId: string; score: number | bigint }>): Promise<AtomicTransactionResult> {
    const builder = AtomicUtils.builder(this.kv);
    
    for (const update of updates) {
      const key = this.getScoreKey(update.playerId);
      const value = typeof update.score === "number" ? BigInt(update.score) : update.score;
      builder.set(key, new Deno.KvU64(value));
    }
    
    return await builder.commit();
  }

  // Private helper methods

  private getPlayerCounter(playerId: string) {
    return AtomicUtils.counter(this.kv, this.getScoreKey(playerId));
  }

  private getScoreKey(playerId: string): Deno.KvKey {
    return ["leaderboard", this.gameId, "scores", playerId];
  }

  private getScoreKeyPrefix(): Deno.KvKey {
    return ["leaderboard", this.gameId, "scores"];
  }
}

// Usage example:
if (import.meta.main) {
  const kv = await Deno.openKv(":memory:");
  const leaderboard = new AtomicLeaderboard(kv, "game1");

  // Add some players
  await leaderboard.updateScore("alice", 1000);
  await leaderboard.updateScore("bob", 850);
  await leaderboard.updateScore("charlie", 1200);

  // Increment Alice's score
  await leaderboard.incrementScore("alice", 50);

  // Get top players
  const topPlayers = await leaderboard.getTopPlayers(3);
  console.log("Top Players:", topPlayers);

  // Get Alice's rank
  const aliceRank = await leaderboard.getPlayerRank("alice");
  console.log("Alice's rank:", aliceRank);

  // Get leaderboard stats
  const stats = await leaderboard.getStats();
  console.log("Leaderboard stats:", stats);

  kv.close();
}
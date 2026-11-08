export interface LeaderboardEntry {
  playerId: string;
  /** Whole points as a decimal string, e.g. "37". */
  points: string;
  /** 1-based; null when the player has no points. */
  position: number | null;
}

export interface Leaderboard {
  top: LeaderboardEntry[];
  player: LeaderboardEntry;
}

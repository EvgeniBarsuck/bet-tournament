-- Points become whole: floor(winAmount × rate) per bet. A rollback subtracts the
-- saved per-bet value, so it stays exact. Existing fractional awards are floored
-- and every score is rebuilt from the bets it consists of.
UPDATE bets SET points = floor(points), updated_at = now() WHERE points <> floor(points);

UPDATE player_scores s
SET points = coalesce(
      (SELECT sum(b.points) FROM bets b WHERE b.player_id = s.player_id AND b.status = 'settled'),
      0),
    updated_at = now();

ALTER TABLE bets ADD CONSTRAINT bets_points_whole CHECK (points = floor(points));
ALTER TABLE player_scores ADD CONSTRAINT player_scores_points_whole CHECK (points = floor(points));

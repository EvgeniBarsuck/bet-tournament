-- One row per bet ever seen. Kept forever: it is what makes redelivered and
-- late events idempotent.
CREATE TABLE bets (
  bet_id      varchar(128) COLLATE "C" PRIMARY KEY,
  player_id   varchar(128) COLLATE "C" NOT NULL,
  status      text NOT NULL CHECK (status IN ('settled', 'rolled_back')),
  -- Settlement fields are NULL only for a rollback that arrived before its settle.
  currency    varchar(3),
  stake       numeric(20, 8),
  win_amount  numeric(20, 8),
  settled_at  timestamptz,
  usd_rate    numeric(20, 8),
  -- Exactly what was added to the player's score; a rollback subtracts this.
  points      numeric NOT NULL DEFAULT 0 CHECK (points >= 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE player_scores (
  player_id   varchar(128) COLLATE "C" PRIMARY KEY,
  points      numeric NOT NULL DEFAULT 0 CHECK (points >= 0),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX player_scores_ranking ON player_scores (points DESC, player_id) WHERE points > 0;

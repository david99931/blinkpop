-- Artist-based underdog tiers: capture the artist's average plays at pick
-- time. NULL on legacy picks / providers without artist stats — scoring
-- falls back to the track baseline for those.
ALTER TABLE picks ADD COLUMN artist_avg_plays INTEGER;

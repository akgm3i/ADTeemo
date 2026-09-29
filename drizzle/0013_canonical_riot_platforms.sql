-- Preserve the identity of an observed legacy game before changing its account
-- routing. Existing match IDs, pending rank snapshots and delivery receipts are
-- historical identities and must never be rewritten to an SG2 match ID.
UPDATE `match_watchers`
SET `current_match_id` = (
  SELECT upper(`riot_accounts`.`platform`) || '_' || `match_watchers`.`current_game_id`
  FROM `riot_accounts`
  WHERE `riot_accounts`.`puuid` = `match_watchers`.`riot_account_puuid`
    AND `riot_accounts`.`discord_id` = `match_watchers`.`target_discord_id`
    AND `riot_accounts`.`platform` IN ('ph2', 'th2')
)
WHERE `current_match_id` IS NULL
  AND `current_game_id` IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM `riot_accounts`
    WHERE `riot_accounts`.`puuid` = `match_watchers`.`riot_account_puuid`
      AND `riot_accounts`.`discord_id` = `match_watchers`.`target_discord_id`
      AND `riot_accounts`.`platform` IN ('ph2', 'th2')
  );
--> statement-breakpoint
UPDATE `riot_accounts`
SET `platform` = 'sg2', `region` = 'sea'
WHERE `platform` IN ('ph2', 'th2');

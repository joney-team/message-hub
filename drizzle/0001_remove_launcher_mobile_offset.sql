UPDATE `channels`
SET `settings` = json_remove(`settings`, '$.launcher.mobileOffset')
WHERE json_valid(`settings`)
  AND json_type(`settings`, '$.launcher.mobileOffset') IS NOT NULL;

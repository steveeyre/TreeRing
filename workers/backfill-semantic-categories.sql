-- One-off backfill: entries saved before 语录 / 新词 became first-class categories only carry
-- them as tags. Promote the tag into categories so the new filters and chips find them.
-- Entries where a parent explicitly picked a category (manual_categories non-empty) are left alone.

UPDATE entries
SET categories = CASE
      WHEN EXISTS (SELECT 1 FROM json_each(entries.tags) j WHERE j.value = '新词') THEN '["newWords"]'
      ELSE '["quotes"]'
    END,
    ai_categories = CASE
      WHEN EXISTS (SELECT 1 FROM json_each(entries.tags) j WHERE j.value = '新词') THEN '["newWords"]'
      ELSE '["quotes"]'
    END
WHERE deleted_at IS NULL
  AND (
    EXISTS (SELECT 1 FROM json_each(entries.tags) j WHERE j.value = '语录')
    OR EXISTS (SELECT 1 FROM json_each(entries.tags) j WHERE j.value = '新词')
  )
  AND NOT EXISTS (
    SELECT 1 FROM json_each(entries.categories) c WHERE c.value IN ('quotes', 'newWords')
  )
  AND (manual_categories IS NULL OR manual_categories = '[]');

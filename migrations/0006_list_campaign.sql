-- A list becomes a campaign when it says what you're saying to these people
-- and how many a day you'll say it to. Without those two facts it's a folder,
-- and the daily queue has no principled way to pick who's next.
--
-- perDay = 0 (the default) means the list is just a collection: curated, but
-- not feeding the morning.
ALTER TABLE lists ADD COLUMN angle TEXT;
ALTER TABLE lists ADD COLUMN perDay INTEGER NOT NULL DEFAULT 0;

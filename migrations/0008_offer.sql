-- "Template" described the mechanism; "offer" describes the thing. What you
-- put in front of someone is an offer, and offers are what you improve when
-- nobody replies — so the list holds an offer, and a list with an offer and a
-- daily number is running.
ALTER TABLE lists RENAME COLUMN template TO offer;

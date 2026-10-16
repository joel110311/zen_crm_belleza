-- Pipeline is retired. Preserve the latest contact capture/scoring state and tags.
-- Additive only: historical opportunities, notes and intelligence remain recoverable.
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "aiState" JSONB;

UPDATE "Contact" AS c
SET "aiState" = previous.state
FROM (
    SELECT DISTINCT ON (d."contactId") d."contactId",
        to_jsonb(li) - 'id' - 'dealId' - 'createdAt' - 'updatedAt' AS state
    FROM "Deal" d JOIN "LeadIntelligence" li ON li."dealId" = d.id
    ORDER BY d."contactId", d."updatedAt" DESC, d.id DESC
) AS previous
WHERE c.id = previous."contactId" AND c."aiState" IS NULL;

UPDATE "Contact" AS c SET tags = c.tags || additions.tags
FROM (
    SELECT d."contactId", array_agg(DISTINCT t.name ORDER BY t.name) AS tags
    FROM "Deal" d JOIN "DealTag" dt ON dt."dealId" = d.id
    JOIN "Tag" t ON t.id = dt."tagId" JOIN "Contact" linked ON linked.id = d."contactId"
    WHERE NOT (t.name = ANY(linked.tags))
    GROUP BY d."contactId"
) AS additions
WHERE c.id = additions."contactId";

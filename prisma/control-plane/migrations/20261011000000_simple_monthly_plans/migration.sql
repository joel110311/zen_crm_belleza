BEGIN;

-- Preserve plan IDs/slugs and paid-period history. New checkouts use these prices.
UPDATE "Plan" AS p
SET "name" = v.name,
    "description" = v.description,
    "currency" = 'MXN',
    "monthlyAmountCents" = v.amount,
    "limits" = (p."limits" - 'fairUse') || jsonb_build_object('chatbotMessagesPerMonth', v.reply_limit),
    "features" = p."features" || '{"chatbot":true}'::jsonb,
    "stripeMonthlyPriceId" = NULL,
    "updatedAt" = CURRENT_TIMESTAMP
FROM (VALUES
    ('esencial', 'Esencial', 'CRM, agenda, reservas y chatbot con hasta 1,000 respuestas al mes.', 29900, 1000),
    ('automatiza', 'Crecimiento', 'CRM, agenda, reservas y chatbot con hasta 3,000 respuestas al mes.', 49900, 3000),
    ('pro', 'Elite', 'CRM, agenda, reservas y chatbot con hasta 10,000 respuestas al mes.', 79900, 10000)
) AS v(slug, name, description, amount, reply_limit)
WHERE p.slug = v.slug;

-- External Stripe prices are immutable; old monthly IDs must not charge old prices.
UPDATE "BillingPrice"
SET "isActive" = false, "updatedAt" = CURRENT_TIMESTAMP
WHERE provider = 'STRIPE' AND interval = 'MONTHLY'
  AND "planId" IN (SELECT id FROM "Plan" WHERE slug IN ('esencial', 'automatiza', 'pro'));

COMMIT;

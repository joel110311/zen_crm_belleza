UPDATE "PatientEducationArticle"
SET "audience" = 'clientes'
WHERE LOWER("audience") = CONCAT('pa', 'cientes');

ALTER TABLE "PatientEducationArticle"
ALTER COLUMN "audience" SET DEFAULT 'clientes';

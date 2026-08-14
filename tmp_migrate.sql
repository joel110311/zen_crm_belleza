-- Migration: Consolidate "Leads Entrantes" + "Nuevo Lead" → single "Nuevo Lead" stage
BEGIN;

-- 1. Move any deals from old "Nuevo Lead" to "Leads Entrantes"
UPDATE "Deal" SET "stageId" = 'cmlimohil00002svvhemqw2u3'
WHERE "stageId" = 'cmlimohja00012svvxf8swd3y';

-- 2. Delete the old "Nuevo Lead" stage (now empty)
DELETE FROM "PipelineStage" WHERE id = 'cmlimohja00012svvxf8swd3y';

-- 3. Rename "Leads Entrantes" to "Nuevo Lead" and keep isIncoming=true
UPDATE "PipelineStage"
SET name = 'Nuevo Lead', "isIncoming" = true
WHERE id = 'cmlimohil00002svvhemqw2u3';

-- 4. Reorder remaining stages: Nuevo Lead=0, Calificado=1, Propuesta=2, Negociación=3, Cerrado Ganado=4, Cerrado Perdido=5
UPDATE "PipelineStage" SET "order" = 0 WHERE id = 'cmlimohil00002svvhemqw2u3';
UPDATE "PipelineStage" SET "order" = 1 WHERE id = 'cmlimohjn00022svvotwddrs9';
UPDATE "PipelineStage" SET "order" = 2 WHERE id = 'cmlimohk100032svv7qkgfz27';
UPDATE "PipelineStage" SET "order" = 3 WHERE id = 'cmlimohkk00042svvryzgqqpp';
UPDATE "PipelineStage" SET "order" = 4 WHERE id = 'cmlimohky00052svvhbhhyqzl';
UPDATE "PipelineStage" SET "order" = 5 WHERE id = 'cmlimohld00062svvnqhyd571';

COMMIT;

-- Verify
SELECT id, name, "order", "isIncoming" FROM "PipelineStage" ORDER BY "order";

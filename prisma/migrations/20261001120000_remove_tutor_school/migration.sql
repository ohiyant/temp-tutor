-- Tutors write everything under their name in their bio now, so the School
-- field goes. Keep any school a tutor entered by moving it to the top of their bio.
UPDATE "Tutor"
SET "bio" = CASE
    WHEN "bio" IS NULL OR "bio" = '' THEN "school"
    ELSE LEFT("school" || E'\n\n' || "bio", 500)
END
WHERE "school" IS NOT NULL AND "school" <> '';

ALTER TABLE "Tutor" DROP COLUMN "school";

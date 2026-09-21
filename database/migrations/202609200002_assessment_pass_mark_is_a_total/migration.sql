-- The pass mark is a total across every criterion in the rubric, not a score on one of them, so
-- bounding it by `scale_max` alone made a two-criterion rubric unable to ask for more than half.
-- The real ceiling depends on how many criteria the rubric has, which SQL cannot see from here, so
-- the constraint now checks only what it can honestly check: a pass mark is not negative. The
-- service holds the real bound, next to the rubric it can count.
ALTER TABLE "assessments" DROP CONSTRAINT "assessments_pass_mark_within_scale";
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_pass_mark_not_negative" CHECK ("pass_mark" >= 0);

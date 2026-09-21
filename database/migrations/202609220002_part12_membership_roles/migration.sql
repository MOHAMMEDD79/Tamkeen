-- PART-12 adds three specialisations inside a membership. 08-PERMISSION-EXTENSIONS is explicit that
-- they are roles within an organisation rather than new kinds of user, so they join the existing
-- enum rather than becoming a parallel mechanism nothing else understands.
ALTER TYPE "MembershipRole" ADD VALUE IF NOT EXISTS 'Mentor';
ALTER TYPE "MembershipRole" ADD VALUE IF NOT EXISTS 'VolunteerCoordinator';
ALTER TYPE "MembershipRole" ADD VALUE IF NOT EXISTS 'CaseWorker';

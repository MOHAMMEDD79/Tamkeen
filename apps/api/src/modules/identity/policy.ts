export const rolePermissions = {
  Owner: ['organization.read', 'organization.manage', 'bank.manage', 'member.read', 'member.invite', 'member.role.update', 'ownership.transfer', 'project.read', 'project.create', 'project.update', 'project.submit', 'project.pause', 'project.close', 'report.read', 'report.create', 'report.submit', 'report.publish', 'agreement.manage', 'agreement.accept', 'agreement.review'],
  OrgAdmin: ['organization.read', 'organization.manage', 'bank.manage', 'member.read', 'member.invite', 'member.role.update', 'project.read', 'project.create', 'project.update', 'project.submit', 'project.pause', 'project.close', 'report.read', 'report.create', 'report.submit', 'report.publish', 'agreement.manage', 'agreement.review', 'assistance.manage'],
  ProjectManager: ['organization.read', 'project.read', 'project.create', 'project.update', 'project.submit', 'project.pause', 'project.close', 'report.read', 'report.create', 'report.submit', 'report.publish', 'agreement.manage'],
  FinanceMaker: ['organization.read', 'finance.read', 'finance.export', 'payout.request', 'refund.request', 'sponsorship.fund', 'stipend.request'],
  FinanceApprover: ['organization.read', 'finance.read', 'finance.export', 'payout.approve', 'refund.approve'],
  // PART-11. A recruiter runs the hiring, but verifying that somebody actually started is not part
  // of it: 07 wants the outcome confirmed by the parties or by a reviewer, and a recruiter marking
  // their own placements as started is the figure most worth not trusting.
  Recruiter: ['organization.read', 'job.manage', 'job.publish', 'application.review', 'program.read', 'placement.verify'],
  // PART-10. `program.publish` is separate from `program.manage` for the same reason opening an
  // offering is separate from editing it: an independent reviewer approves, and the operator then
  // decides when applications actually open. Approving is not publishing.
  //
  // PART-11 added `report.read`, which was missing: this role already held `report.publish`, so it
  // could publish a report it was not allowed to read, and PRG-09.A04 — the impact export on its
  // own screen — was refused to the role the screen belongs to. A recruiter still does not hold it:
  // running the hiring and publishing the figures it produces are deliberately different jobs.
  ProgramManager: ['organization.read', 'program.manage', 'program.read', 'program.publish', 'application.review', 'candidate.export', 'attendance.record', 'attendance.correct', 'attendance.review', 'report.read', 'report.publish', 'placement.verify', 'placement.review', 'stipend.request', 'certificate.issue', 'certificate.revoke', 'proposal.review', 'agreement.manage', 'agreement.review'],
  // A trainer's reach is their assigned cohorts, not the organisation's. The permission is the
  // floor; the CohortTrainer row is what actually decides which cohort they can touch.
  Trainer: ['organization.read', 'program.read', 'attendance.record', 'attendance.correct', 'assessment.record'],
  // PART-08: running the data room is separated from editing the offering, so an analyst can be
  // let into the room's administration without being able to change the terms being offered.
  InvestmentManager: ['organization.read', 'offering.manage', 'dataroom.manage', 'investment.read', 'investment.export'],
  Analyst: ['organization.read', 'project.read', 'report.read', 'report.create', 'program.read'],
  Viewer: ['organization.read', 'project.read', 'report.read'],
  // PART-12. Three roles the screen catalogue names as specialisations inside a membership, not as
  // new kinds of user (08-PERMISSION-EXTENSIONS).
  //
  // A mentor holds no decision. 08 is explicit that a mentor comments and does not decide by
  // default, so `proposal.review` is deliberately absent: their reach is the ideas they were
  // assigned, decided by a MentorAssignment row the way a CohortTrainer row decides a trainer's.
  Mentor: ['organization.read', 'program.read'],
  // A coordinator runs the organisation's volunteering. It carries no access to beneficiary files:
  // 08 says volunteer management does not open assistance records.
  VolunteerCoordinator: ['organization.read', 'volunteer.manage'],
  // An assistance case is the most sensitive record here, so the permission is its own role and the
  // assignment on the case decides which one. Holding it does not open the organisation's money,
  // its programmes or its volunteers.
  CaseWorker: ['organization.read', 'assistance.manage']
} as const;

export type Role = keyof typeof rolePermissions;
export type Permission = (typeof rolePermissions)[Role][number];

export class IdentityError extends Error {
  constructor(public readonly code: 'unauthenticated' | 'forbidden' | 'invalid_input' | 'conflict' | 'not_found' | 'invitation_unavailable' | 'transfer_unavailable' | 'upload_unavailable' | 'upload_incomplete' | 'mfa_unavailable', public readonly status: number) { super(code); }
}

export function permissionsFor(roles: readonly Role[]): Set<Permission> {
  return new Set(roles.flatMap(role => [...rolePermissions[role]]));
}

export function assertPermission(input: {
  userStatus: string; organizationStatus: string; membershipStatus: string;
  roles: readonly Role[]; permission: Permission; actorId: string; makerId?: string;
}) {
  if (input.userStatus !== 'active' || input.organizationStatus !== 'active' || input.membershipStatus !== 'active' || !permissionsFor(input.roles).has(input.permission)) throw new IdentityError('forbidden', 403);
  if (['payout.approve', 'refund.approve'].includes(input.permission) && (!input.makerId || input.actorId === input.makerId)) throw new IdentityError('forbidden', 403);
}

// Delegation is constrained by actual permissions, never by a numeric role rank.
export function assertDelegation(actorRoles: readonly Role[], requestedRoles: readonly Role[]) {
  if (!Array.isArray(requestedRoles) || !requestedRoles.length || requestedRoles.some(role => !Object.hasOwn(rolePermissions, role)) || new Set(requestedRoles).size !== requestedRoles.length || requestedRoles.includes('Owner')) throw new IdentityError('forbidden', 403);
  const actorPermissions = permissionsFor(actorRoles);
  for (const permission of permissionsFor(requestedRoles)) {
    if (!actorPermissions.has(permission)) throw new IdentityError('forbidden', 403);
  }
}

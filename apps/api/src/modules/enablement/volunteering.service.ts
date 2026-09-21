import { randomBytes } from 'node:crypto';
import type { DatabaseClient } from '@tamkeen/database';
import { IdentityError } from '../identity/policy.js';
import { IdentityService } from '../identity/identity.service.js';

/**
 * Volunteering (PRG-13, PER-17).
 *
 * **Nobody approves their own hours.** It is the one rule that decides whether a reported volunteer
 * figure means anything, so it is a database trigger as well as a check here — and a coordinator
 * who is also volunteering on the same opportunity is refused by the same rule, not exempted from
 * it because of their role.
 *
 * **A coordinator sees volunteers, not beneficiaries.** 08 is explicit that volunteer management
 * opens no beneficiary file, so this module reads nothing from assistance, and the volunteer's own
 * record carries only what running the assignment needs.
 *
 * **A placement needs a named supervisor.** 07 requires clear responsibility wherever a person is
 * placed with an organisation, so the opportunity carries one and cannot be published without it.
 */

const text = (value: unknown, min: number, max: number) => {
  if (typeof value !== 'string') throw new IdentityError('invalid_input', 422);
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) throw new IdentityError('invalid_input', 422);
  return trimmed;
};

const optionalText = (value: unknown, max: number) => {
  if (value === undefined || value === null) return '';
  return text(value, 0, max);
};

const plainDate = (value: unknown) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new IdentityError('invalid_input', 422);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new IdentityError('invalid_input', 422);
  return date;
};

const slugify = (title: string) => {
  const base = title.toLowerCase().normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 110);
  return `${base || 'volunteer'}-${randomBytes(3).toString('hex')}`;
};

/** States in which an opportunity is publicly listed. */
const PUBLIC_STATES = ['open', 'paused'] as const;
/** Assignments that hold a place. */
const HOLDING = ['offered', 'accepted', 'active'] as const;

export class VolunteeringService {
  private readonly identity: IdentityService;
  constructor(private readonly db: DatabaseClient) {
    this.identity = new IdentityService(db);
  }

  // ---------------------------------------------------------------- PRG-13: the coordinator

  /** PRG-13.A01, first half. A draft opportunity, visible to nobody. */
  async createOpportunity(actorId: string, organizationId: string, input: {
    title: string; summary: string; tasks: string; requirements?: string | undefined;
    supervisorId: string; city?: string | undefined; deliveryMode?: 'in_person' | 'remote' | 'hybrid' | undefined;
    capacity?: number | undefined; hoursPerWeek?: number | undefined;
    startsAt?: string | null | undefined; endsAt?: string | null | undefined;
    withdrawalPolicy?: string | undefined;
  }) {
    await this.identity.access(actorId, organizationId, 'volunteer.manage');
    const parsed = await this.parseOpportunity(input, organizationId);

    const opportunity = await this.db.volunteerOpportunity.create({
      data: { organizationId, slug: slugify(parsed.title), ...parsed, state: 'draft', createdBy: actorId }
    });
    return this.opportunityView(opportunity);
  }

  async updateOpportunity(actorId: string, organizationId: string, opportunityId: string, input: Parameters<VolunteeringService['createOpportunity']>[2] & { version: number }) {
    await this.identity.access(actorId, organizationId, 'volunteer.manage');
    const parsed = await this.parseOpportunity(input, organizationId);

    return this.db.$transaction(async tx => {
      const opportunity = await tx.volunteerOpportunity.findFirst({ where: { id: opportunityId, organizationId } });
      if (!opportunity) throw new IdentityError('not_found', 404);
      // Editing what people applied to, while they are applying, moves the goalposts under them.
      if (!['draft', 'paused'].includes(opportunity.state)) throw new IdentityError('conflict', 409);
      if (opportunity.version !== input.version) throw new IdentityError('conflict', 409);
      const updated = await tx.volunteerOpportunity.update({ where: { id: opportunity.id }, data: { ...parsed, version: { increment: 1 } } });
      return this.opportunityView(updated);
    });
  }

  /** PRG-13.A01. Publishing. Refused unless the things a volunteer decides on are all stated. */
  async publishOpportunity(actorId: string, organizationId: string, opportunityId: string, version: number) {
    await this.identity.access(actorId, organizationId, 'volunteer.manage');

    return this.db.$transaction(async tx => {
      const opportunity = await tx.volunteerOpportunity.findFirst({ where: { id: opportunityId, organizationId }, include: { organization: true } });
      if (!opportunity) throw new IdentityError('not_found', 404);
      if (!['draft', 'paused'].includes(opportunity.state)) throw new IdentityError('conflict', 409);
      if (opportunity.version !== version) throw new IdentityError('conflict', 409);
      // An unverified organisation cannot take people's time any more than it can take their money.
      if (opportunity.organization.verification !== 'verified') throw new IdentityError('conflict', 409);
      const readiness = this.checkReadiness(opportunity);
      if (!readiness.ready) throw new IdentityError('conflict', 409);

      const updated = await tx.volunteerOpportunity.update({
        where: { id: opportunity.id }, data: { state: 'open', stateReason: '', version: { increment: 1 } }
      });
      return this.opportunityView(updated);
    });
  }

  async closeOpportunity(actorId: string, organizationId: string, opportunityId: string, input: { reason: string; version: number }) {
    await this.identity.access(actorId, organizationId, 'volunteer.manage');
    const reason = text(input.reason, 10, 200);

    return this.db.$transaction(async tx => {
      const opportunity = await tx.volunteerOpportunity.findFirst({ where: { id: opportunityId, organizationId } });
      if (!opportunity) throw new IdentityError('not_found', 404);
      if (!['open', 'paused'].includes(opportunity.state)) throw new IdentityError('conflict', 409);
      if (opportunity.version !== input.version) throw new IdentityError('conflict', 409);

      // People waiting on an answer are told, rather than left with a page that stops loading.
      const waiting = await tx.volunteerApplication.updateMany({
        where: { opportunityId, state: 'submitted' },
        data: { state: 'rejected', decisionReason: reason, decidedAt: new Date() }
      });
      const updated = await tx.volunteerOpportunity.update({
        where: { id: opportunity.id }, data: { state: 'closed', stateReason: reason, version: { increment: 1 } }
      });
      return { ...this.opportunityView(updated), applicationsClosed: waiting.count };
    });
  }

  async validateOpportunity(actorId: string, organizationId: string, opportunityId: string) {
    await this.identity.access(actorId, organizationId, 'volunteer.manage');
    const opportunity = await this.db.volunteerOpportunity.findFirst({ where: { id: opportunityId, organizationId } });
    if (!opportunity) throw new IdentityError('not_found', 404);
    return this.checkReadiness(opportunity);
  }

  /** PRG-13.A02. Deciding on an application, against the places actually left. */
  async decideApplication(actorId: string, organizationId: string, applicationId: string, input: {
    outcome: 'accepted' | 'rejected'; reason: string; version: number;
  }) {
    await this.identity.access(actorId, organizationId, 'volunteer.manage');
    const reason = input.outcome === 'rejected' ? text(input.reason, 10, 1000) : optionalText(input.reason, 1000);
    if (!['accepted', 'rejected'].includes(input.outcome)) throw new IdentityError('invalid_input', 422);

    return this.db.$transaction(async tx => {
      const application = await tx.volunteerApplication.findFirst({
        where: { id: applicationId, opportunity: { organizationId } },
        include: { opportunity: true }
      });
      if (!application) throw new IdentityError('not_found', 404);
      if (application.state !== 'submitted') throw new IdentityError('conflict', 409);
      if (application.version !== input.version) throw new IdentityError('conflict', 409);

      if (input.outcome === 'accepted') {
        // The places an opportunity advertised are the places it has, counted the same way the
        // public page counts them.
        const taken = await tx.volunteerAssignment.count({ where: { opportunityId: application.opportunityId, state: { in: [...HOLDING] } } });
        if (taken >= application.opportunity.capacity) throw new IdentityError('conflict', 409);
      }

      const updated = await tx.volunteerApplication.update({
        where: { id: application.id },
        data: { state: input.outcome, decisionReason: reason, decidedAt: new Date(), version: { increment: 1 } }
      });
      await tx.outboxEvent.create({ data: { topic: 'volunteer_application.decided', payload: { applicationId, outcome: input.outcome } } });
      return {
        ...this.applicationView(updated),
        /** Accepting an application is not an assignment: the task is a separate, named thing. */
        assignmentCreated: false as const,
        nextStep: input.outcome === 'accepted' ? 'assign_a_task' : ''
      };
    });
  }

  /** PRG-13.A03. Assigning a task to somebody who was accepted. They still have to accept it. */
  async assign(actorId: string, organizationId: string, input: {
    opportunityId: string; userId: string; task: string; startsAt: string; endsAt?: string | null | undefined;
  }) {
    await this.identity.access(actorId, organizationId, 'volunteer.manage');
    const task = text(input.task, 5, 1000);
    const startsAt = plainDate(input.startsAt);
    const endsAt = input.endsAt ? plainDate(input.endsAt) : null;
    if (endsAt && endsAt < startsAt) throw new IdentityError('invalid_input', 422);

    return this.db.$transaction(async tx => {
      const opportunity = await tx.volunteerOpportunity.findFirst({ where: { id: input.opportunityId, organizationId } });
      if (!opportunity) throw new IdentityError('not_found', 404);
      if (opportunity.state !== 'open') throw new IdentityError('conflict', 409);
      // Only somebody the organisation accepted. An assignment to a stranger is a placement nobody
      // agreed to, and 08 keeps a coordinator's reach to the people who chose to be there.
      const application = await tx.volunteerApplication.findUnique({
        where: { opportunityId_userId: { opportunityId: input.opportunityId, userId: input.userId } }
      });
      if (!application || application.state !== 'accepted') throw new IdentityError('conflict', 409);

      const taken = await tx.volunteerAssignment.count({ where: { opportunityId: input.opportunityId, state: { in: [...HOLDING] } } });
      if (taken >= opportunity.capacity) throw new IdentityError('conflict', 409);

      const assignment = await tx.volunteerAssignment.create({
        data: { opportunityId: input.opportunityId, userId: input.userId, task, startsAt, endsAt, state: 'offered', assignedBy: actorId }
      });
      await tx.outboxEvent.create({ data: { topic: 'volunteer_assignment.offered', payload: { assignmentId: assignment.id } } });
      return { ...this.assignmentView(assignment), awaitingVolunteerAcceptance: true as const };
    });
  }

  async endAssignment(actorId: string, organizationId: string, assignmentId: string, input: { reason: string; version: number }) {
    await this.identity.access(actorId, organizationId, 'volunteer.manage');
    const reason = text(input.reason, 10, 1000);
    const assignment = await this.db.volunteerAssignment.findFirst({ where: { id: assignmentId, opportunity: { organizationId } } });
    if (!assignment) throw new IdentityError('not_found', 404);
    if (assignment.state === 'ended') throw new IdentityError('conflict', 409);
    if (assignment.version !== input.version) throw new IdentityError('conflict', 409);
    const updated = await this.db.volunteerAssignment.update({
      where: { id: assignment.id },
      data: { state: 'ended', endReason: reason, endsAt: assignment.endsAt ?? new Date(), version: { increment: 1 } }
    });
    return this.assignmentView(updated);
  }

  /**
   * PRG-13.A04. Approving hours.
   *
   * The approver is never the volunteer — checked here and refused by a trigger underneath, so a
   * coordinator who also volunteers on the same opportunity cannot sign off their own time.
   */
  async decideHours(actorId: string, organizationId: string, hoursId: string, input: {
    outcome: 'approved' | 'rejected'; reason?: string | undefined; version: number;
  }) {
    const membership = await this.identity.access(actorId, organizationId, 'volunteer.manage');
    if (!['approved', 'rejected'].includes(input.outcome)) throw new IdentityError('invalid_input', 422);
    const reason = input.outcome === 'rejected' ? text(input.reason, 10, 1000) : optionalText(input.reason, 1000);

    return this.db.$transaction(async tx => {
      const hours = await tx.volunteerHours.findFirst({
        where: { id: hoursId, assignment: { opportunity: { organizationId } } },
        include: { assignment: true }
      });
      if (!hours) throw new IdentityError('not_found', 404);
      if (hours.state !== 'submitted') throw new IdentityError('conflict', 409);
      if (hours.version !== input.version) throw new IdentityError('conflict', 409);
      // The rule, checked before the write as well as under it.
      if (hours.assignment.userId === membership.user.id) throw new IdentityError('forbidden', 403);

      const updated = await tx.volunteerHours.update({
        where: { id: hours.id },
        data: {
          state: input.outcome,
          decisionReason: reason,
          ...(input.outcome === 'approved' ? { approvedBy: membership.user.id, approvedAt: new Date() } : {}),
          version: { increment: 1 }
        }
      });
      return { ...this.hoursView(updated), approvedBySomeoneElse: true as const };
    });
  }

  /** PRG-13. The coordinator's board. */
  async board(actorId: string, organizationId: string) {
    await this.identity.access(actorId, organizationId, 'volunteer.manage');
    const opportunities = await this.db.volunteerOpportunity.findMany({
      where: { organizationId },
      include: {
        supervisor: { select: { id: true, name: true } },
        applications: { include: { user: { select: { id: true, name: true } } }, orderBy: { createdAt: 'asc' } },
        assignments: {
          include: {
            user: { select: { id: true, name: true } },
            hours: { orderBy: { workedOn: 'desc' } }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    return opportunities.map(opportunity => {
      const taken = opportunity.assignments.filter(assignment => HOLDING.includes(assignment.state as typeof HOLDING[number])).length;
      return {
        ...this.opportunityView(opportunity),
        supervisor: opportunity.supervisor,
        placesTaken: taken,
        placesLeft: Math.max(opportunity.capacity - taken, 0),
        readiness: this.checkReadiness(opportunity),
        applications: opportunity.applications.map(application => ({
          ...this.applicationView(application),
          volunteer: { id: application.user.id, name: application.user.name },
          motivation: application.motivation,
          availability: application.availability
        })),
        assignments: opportunity.assignments.map(assignment => ({
          ...this.assignmentView(assignment),
          volunteer: { id: assignment.user.id, name: assignment.user.name },
          hours: assignment.hours.map(entry => this.hoursView(entry)),
          minutesApproved: assignment.hours.filter(entry => entry.state === 'approved').reduce((total, entry) => total + entry.minutes, 0),
          minutesAwaiting: assignment.hours.filter(entry => entry.state === 'submitted').reduce((total, entry) => total + entry.minutes, 0)
        }))
      };
    });
  }

  // ---------------------------------------------------------------- PER-17 and the public page

  /** The public list. A draft is absent rather than forbidden. */
  async browse(filters: { city?: string | undefined }) {
    const rows = await this.db.volunteerOpportunity.findMany({
      where: {
        state: { in: [...PUBLIC_STATES] },
        organization: { status: 'active' },
        ...(filters.city ? { city: text(filters.city, 1, 100) } : {})
      },
      include: {
        organization: { select: { slug: true, displayName: true, city: true, verification: true } },
        assignments: { where: { state: { in: [...HOLDING] } }, select: { id: true } }
      },
      orderBy: { createdAt: 'desc' },
      take: 100
    });
    return rows.map(row => this.publicView(row));
  }

  async publicOpportunity(slug: string) {
    if (typeof slug !== 'string' || slug.length > 120) throw new IdentityError('not_found', 404);
    const opportunity = await this.db.volunteerOpportunity.findFirst({
      where: { slug, state: { in: [...PUBLIC_STATES] }, organization: { status: 'active' } },
      include: {
        organization: { select: { slug: true, displayName: true, city: true, verification: true } },
        assignments: { where: { state: { in: [...HOLDING] } }, select: { id: true } }
      }
    });
    if (!opportunity) throw new IdentityError('not_found', 404);
    return {
      ...this.publicView(opportunity),
      id: opportunity.id,
      tasks: opportunity.tasks,
      requirements: opportunity.requirements,
      withdrawalPolicy: opportunity.withdrawalPolicy,
      /** 07: somebody is answerable for a volunteer. The page says there is one, not who they are. */
      hasNamedSupervisor: true as const,
      /** Stated on the page a person decides from: volunteering is not a job and pays nothing. */
      isPaid: false as const,
      isEmployment: false as const
    };
  }

  /** PER-17.A01. Applying. One per person per opportunity. */
  async apply(actorId: string, input: { opportunityId: string; motivation?: string | undefined; availability?: string | undefined }) {
    const user = await this.identity.activeUser(actorId);

    return this.db.$transaction(async tx => {
      const opportunity = await tx.volunteerOpportunity.findUnique({ where: { id: input.opportunityId } });
      if (!opportunity) throw new IdentityError('not_found', 404);
      if (opportunity.state !== 'open') throw new IdentityError('conflict', 409);
      const duplicate = await tx.volunteerApplication.findUnique({
        where: { opportunityId_userId: { opportunityId: opportunity.id, userId: user.id } }
      });
      if (duplicate) throw new IdentityError('conflict', 409);

      const application = await tx.volunteerApplication.create({
        data: {
          opportunityId: opportunity.id, userId: user.id,
          motivation: optionalText(input.motivation, 2000),
          availability: optionalText(input.availability, 500),
          state: 'submitted'
        }
      });
      return this.applicationView(application);
    });
  }

  /** PER-17.A04. Withdrawing, against the policy the opportunity published. */
  async withdrawApplication(actorId: string, applicationId: string, input: { reason: string; version: number }) {
    const user = await this.identity.activeUser(actorId);
    const reason = text(input.reason, 10, 1000);
    const application = await this.db.volunteerApplication.findUnique({ where: { id: applicationId }, include: { opportunity: true } });
    if (!application || application.userId !== user.id) throw new IdentityError('not_found', 404);
    if (!['submitted', 'accepted'].includes(application.state)) throw new IdentityError('conflict', 409);
    if (application.version !== input.version) throw new IdentityError('conflict', 409);
    const updated = await this.db.volunteerApplication.update({
      where: { id: application.id },
      data: { state: 'withdrawn', decisionReason: reason, decidedAt: new Date(), version: { increment: 1 } }
    });
    return {
      ...this.applicationView(updated),
      /** Returned with the outcome, because the policy is what the withdrawal is judged against. */
      withdrawalPolicy: application.opportunity.withdrawalPolicy
    };
  }

  /** PER-17.A02. Accepting a task. Nobody is placed without agreeing to it. */
  async respondToAssignment(actorId: string, assignmentId: string, input: { accept: boolean; reason?: string | undefined; version: number }) {
    const user = await this.identity.activeUser(actorId);

    return this.db.$transaction(async tx => {
      const assignment = await tx.volunteerAssignment.findUnique({ where: { id: assignmentId } });
      if (!assignment || assignment.userId !== user.id) throw new IdentityError('not_found', 404);
      if (assignment.state !== 'offered') throw new IdentityError('conflict', 409);
      if (assignment.version !== input.version) throw new IdentityError('conflict', 409);

      const updated = input.accept
        ? await tx.volunteerAssignment.update({
            where: { id: assignment.id },
            data: { state: 'accepted', acceptedAt: new Date(), version: { increment: 1 } }
          })
        : await tx.volunteerAssignment.update({
            where: { id: assignment.id },
            data: { state: 'declined', endReason: text(input.reason, 10, 1000), version: { increment: 1 } }
          });
      return this.assignmentView(updated);
    });
  }

  /** PER-17.A03. Logging hours. They are a claim until somebody else approves them. */
  async logHours(actorId: string, input: { assignmentId: string; workedOn: string; minutes: number; note?: string | undefined }) {
    const user = await this.identity.activeUser(actorId);
    const workedOn = plainDate(input.workedOn);
    if (workedOn.getTime() > Date.now()) throw new IdentityError('invalid_input', 422);
    if (!Number.isInteger(input.minutes) || input.minutes <= 0 || input.minutes > 1440) throw new IdentityError('invalid_input', 422);

    return this.db.$transaction(async tx => {
      const assignment = await tx.volunteerAssignment.findUnique({ where: { id: input.assignmentId } });
      if (!assignment || assignment.userId !== user.id) throw new IdentityError('not_found', 404);
      if (!['accepted', 'active'].includes(assignment.state)) throw new IdentityError('conflict', 409);
      // Hours from before the work started, or after it ended, are hours on somebody else's clock.
      if (workedOn < assignment.startsAt) throw new IdentityError('invalid_input', 422);
      if (assignment.endsAt && workedOn > assignment.endsAt) throw new IdentityError('invalid_input', 422);

      const duplicate = await tx.volunteerHours.findUnique({
        where: { assignmentId_workedOn: { assignmentId: assignment.id, workedOn } }
      });
      if (duplicate) throw new IdentityError('conflict', 409);

      const hours = await tx.volunteerHours.create({
        data: { assignmentId: assignment.id, workedOn, minutes: input.minutes, note: optionalText(input.note, 1000), state: 'submitted' }
      });
      if (assignment.state === 'accepted') {
        await tx.volunteerAssignment.update({ where: { id: assignment.id }, data: { state: 'active', version: { increment: 1 } } });
      }
      return { ...this.hoursView(hours), awaitingApproval: true as const, countedYet: false as const };
    });
  }

  /** PER-17. The volunteer's own record. */
  async mine(actorId: string) {
    const user = await this.identity.activeUser(actorId);
    const [applications, assignments] = await Promise.all([
      this.db.volunteerApplication.findMany({
        where: { userId: user.id },
        include: { opportunity: { select: { slug: true, title: true, state: true, withdrawalPolicy: true, organization: { select: { displayName: true } } } } },
        orderBy: { createdAt: 'desc' }
      }),
      this.db.volunteerAssignment.findMany({
        where: { userId: user.id },
        include: {
          opportunity: { select: { slug: true, title: true, organization: { select: { displayName: true } } } },
          hours: { orderBy: { workedOn: 'desc' } }
        },
        orderBy: { createdAt: 'desc' }
      })
    ]);

    return {
      applications: applications.map(application => ({
        ...this.applicationView(application),
        opportunity: { slug: application.opportunity.slug, title: application.opportunity.title, state: application.opportunity.state },
        organization: application.opportunity.organization.displayName,
        withdrawalPolicy: application.opportunity.withdrawalPolicy
      })),
      assignments: assignments.map(assignment => ({
        ...this.assignmentView(assignment),
        opportunity: { slug: assignment.opportunity.slug, title: assignment.opportunity.title },
        organization: assignment.opportunity.organization.displayName,
        hours: assignment.hours.map(entry => this.hoursView(entry)),
        /** Approved and awaiting are two figures, never one total. */
        minutesApproved: assignment.hours.filter(entry => entry.state === 'approved').reduce((total, entry) => total + entry.minutes, 0),
        minutesAwaiting: assignment.hours.filter(entry => entry.state === 'submitted').reduce((total, entry) => total + entry.minutes, 0)
      }))
    };
  }

  // ---------------------------------------------------------------- shaping

  private async parseOpportunity(input: Parameters<VolunteeringService['createOpportunity']>[2], organizationId: string) {
    const deliveryMode = input.deliveryMode ?? 'in_person';
    if (!['in_person', 'remote', 'hybrid'].includes(deliveryMode)) throw new IdentityError('invalid_input', 422);
    const capacity = input.capacity ?? 1;
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 10000) throw new IdentityError('invalid_input', 422);
    const hoursPerWeek = input.hoursPerWeek ?? 0;
    if (!Number.isInteger(hoursPerWeek) || hoursPerWeek < 0 || hoursPerWeek > 80) throw new IdentityError('invalid_input', 422);

    // 07: a named person is answerable for the volunteers, and they are a member of this
    // organisation rather than a name typed into a field.
    const supervisor = await this.db.membership.findUnique({
      where: { userId_organizationId: { userId: input.supervisorId, organizationId } }
    });
    if (!supervisor || supervisor.status !== 'active') throw new IdentityError('invalid_input', 422);

    const startsAt = input.startsAt ? plainDate(input.startsAt) : null;
    const endsAt = input.endsAt ? plainDate(input.endsAt) : null;
    if (startsAt && endsAt && endsAt < startsAt) throw new IdentityError('invalid_input', 422);

    return {
      title: text(input.title, 4, 200),
      summary: text(input.summary, 20, 2000),
      tasks: text(input.tasks, 10, 4000),
      requirements: optionalText(input.requirements, 2000),
      supervisorId: input.supervisorId,
      city: optionalText(input.city, 100),
      deliveryMode,
      capacity,
      hoursPerWeek,
      startsAt,
      endsAt,
      withdrawalPolicy: optionalText(input.withdrawalPolicy, 1000)
    } as const;
  }

  /** What a publish would refuse, named field by field. */
  private checkReadiness(opportunity: { summary: string; tasks: string; withdrawalPolicy: string; capacity: number }) {
    const blockers: string[] = [];
    if (opportunity.summary.trim().length < 30) blockers.push('summary_too_short');
    if (opportunity.tasks.trim().length < 20) blockers.push('tasks_not_described');
    // Published before anybody applies, so a volunteer knows how they can stop.
    if (opportunity.withdrawalPolicy.trim().length < 10) blockers.push('withdrawal_policy_missing');
    if (opportunity.capacity < 1) blockers.push('capacity_invalid');
    return { ready: blockers.length === 0, blockers };
  }

  private opportunityView(opportunity: {
    id: string; slug: string; title: string; summary: string; tasks: string; requirements: string;
    city: string; deliveryMode: string; capacity: number; hoursPerWeek: number;
    startsAt: Date | null; endsAt: Date | null; withdrawalPolicy: string; state: string;
    stateReason: string; version: number; createdAt: Date;
  }) {
    return {
      id: opportunity.id,
      slug: opportunity.slug,
      title: opportunity.title,
      summary: opportunity.summary,
      tasks: opportunity.tasks,
      requirements: opportunity.requirements,
      city: opportunity.city,
      deliveryMode: opportunity.deliveryMode,
      capacity: opportunity.capacity,
      hoursPerWeek: opportunity.hoursPerWeek,
      startsAt: opportunity.startsAt,
      endsAt: opportunity.endsAt,
      withdrawalPolicy: opportunity.withdrawalPolicy,
      state: opportunity.state,
      stateReason: opportunity.stateReason,
      version: opportunity.version,
      createdAt: opportunity.createdAt,
      /** On every projection: volunteering is unpaid and is not employment. */
      isPaid: false as const
    };
  }

  private publicView(opportunity: {
    slug: string; title: string; summary: string; city: string; deliveryMode: string;
    capacity: number; hoursPerWeek: number; startsAt: Date | null; endsAt: Date | null; state: string;
    organization: { slug: string; displayName: string; city: string; verification: string };
    assignments: Array<{ id: string }>;
  }) {
    return {
      slug: opportunity.slug,
      title: opportunity.title,
      summary: opportunity.summary,
      city: opportunity.city,
      deliveryMode: opportunity.deliveryMode,
      capacity: opportunity.capacity,
      placesLeft: Math.max(opportunity.capacity - opportunity.assignments.length, 0),
      hoursPerWeek: opportunity.hoursPerWeek,
      startsAt: opportunity.startsAt,
      endsAt: opportunity.endsAt,
      state: opportunity.state,
      acceptsApplications: opportunity.state === 'open',
      applicationsUnavailableReason: opportunity.state === 'paused' ? 'paused' : '',
      organization: {
        slug: opportunity.organization.slug,
        displayName: opportunity.organization.displayName,
        city: opportunity.organization.city,
        verified: opportunity.organization.verification === 'verified'
      },
      isPaid: false as const
    };
  }

  private applicationView(application: {
    id: string; opportunityId: string; state: string; decisionReason: string;
    decidedAt: Date | null; version: number; createdAt: Date;
  }) {
    return {
      id: application.id,
      opportunityId: application.opportunityId,
      state: application.state,
      decisionReason: application.decisionReason,
      decidedAt: application.decidedAt,
      version: application.version,
      createdAt: application.createdAt
    };
  }

  private assignmentView(assignment: {
    id: string; opportunityId: string; task: string; startsAt: Date; endsAt: Date | null;
    state: string; endReason: string; acceptedAt: Date | null; version: number; createdAt: Date;
  }) {
    return {
      id: assignment.id,
      opportunityId: assignment.opportunityId,
      task: assignment.task,
      startsAt: assignment.startsAt,
      endsAt: assignment.endsAt,
      state: assignment.state,
      endReason: assignment.endReason,
      acceptedAt: assignment.acceptedAt,
      version: assignment.version,
      createdAt: assignment.createdAt
    };
  }

  private hoursView(hours: {
    id: string; assignmentId: string; workedOn: Date; minutes: number; note: string;
    state: string; approvedAt: Date | null; decisionReason: string; version: number;
  }) {
    return {
      id: hours.id,
      assignmentId: hours.assignmentId,
      workedOn: hours.workedOn,
      minutes: hours.minutes,
      note: hours.note,
      state: hours.state,
      approvedAt: hours.approvedAt,
      decisionReason: hours.decisionReason,
      version: hours.version,
      /** Only approved hours count. Submitted ones are a claim awaiting somebody else's signature. */
      counted: hours.state === 'approved'
    };
  }
}

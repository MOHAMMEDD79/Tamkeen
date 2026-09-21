import type { DatabaseClient } from '@tamkeen/database';

export const csvCell = (value: unknown) => {
  let text = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
};

export async function processExportBatch(db: DatabaseClient, now = new Date(), limit = 5) {
  let processed = 0;
  while (processed < limit) {
    const row = await db.exportJob.findFirst({ where: { state: { in: ['pending', 'failed'] }, nextAttemptAt: { lte: now } }, orderBy: { createdAt: 'asc' } });
    if (!row) break;
    const claim = await db.exportJob.updateMany({ where: { id: row.id, state: row.state, attempts: row.attempts }, data: { state: 'processing', attempts: { increment: 1 } } });
    if (!claim.count) continue;
    try {
      let filename: string;
      let lines: string[];
      if (row.kind === 'audit_csv') {
        const scope = row.scope as { organizationId?: string | null; action?: string | null };
        const events = await db.identityAuditEvent.findMany({ where: { ...(scope.organizationId ? { organizationId: scope.organizationId } : {}), ...(scope.action ? { action: scope.action } : {}) }, orderBy: { createdAt: 'desc' }, take: 10_000 });
        lines = ['id,actor_id,organization_id,action,resource_id,created_at', ...events.map(event => [event.id, event.actorId, event.organizationId, event.action, event.resourceId, event.createdAt.toISOString()].map(csvCell).join(','))];
        filename = `audit-${row.id}.csv`;
      } else if (row.kind === 'contributions_csv') {
        const party = await db.party.findUnique({ where: { userId: row.ownerId }, select: { id: true } });
        const contributions = party ? await db.contribution.findMany({ where: { payerPartyId: party.id }, include: { project: { select: { title: true, slug: true } } }, orderBy: { createdAt: 'desc' }, take: 10_000 }) : [];
        lines = ['id,project,project_slug,state,amount_minor,fee_minor,refunded_minor,currency,confirmed_at,created_at', ...contributions.map(item => [item.id, item.project.title, item.project.slug, item.state, item.amountMinor, item.feeMinor, item.refundedMinor, item.currency, item.confirmedAt?.toISOString(), item.createdAt.toISOString()].map(csvCell).join(','))];
        filename = `contributions-${row.id}.csv`;
      } else if (row.kind === 'investments_csv') {
        const commitments = await db.commitment.findMany({ where: { userId: row.ownerId }, include: { offering: { select: { title: true, slug: true } }, allocation: { select: { units: true, costMinor: true, proofReference: true, finalisedAt: true } } }, orderBy: { createdAt: 'desc' }, take: 10_000 });
        lines = ['id,offering,offering_slug,state,amount_minor,currency,units,allocated_cost_minor,proof_reference,finalised_at,created_at', ...commitments.map(item => [item.id, item.offering.title, item.offering.slug, item.state, item.amountMinor, item.currency, item.allocation?.units, item.allocation?.costMinor, item.allocation?.proofReference, item.allocation?.finalisedAt?.toISOString(), item.createdAt.toISOString()].map(csvCell).join(','))];
        filename = `investments-${row.id}.csv`;
      } else if (row.kind === 'organization_contributions_csv') {
        const scope = row.scope as { organizationId?: string; projectId?: string };
        if (!scope.organizationId || !scope.projectId) throw new Error('invalid_export_scope');
        const contributions = await db.contribution.findMany({ where: { projectId: scope.projectId, project: { organizationId: scope.organizationId } }, orderBy: { createdAt: 'desc' }, take: 10_000 });
        lines = ['id,state,amount_minor,fee_minor,refunded_minor,currency,visibility,confirmed_at,created_at', ...contributions.map(item => [item.id, item.state, item.amountMinor, item.feeMinor, item.refundedMinor, item.currency, item.visibility, item.confirmedAt?.toISOString(), item.createdAt.toISOString()].map(csvCell).join(','))];
        filename = `organization-contributions-${row.id}.csv`;
      } else if (row.kind === 'organization_ledger_csv') {
        const scope = row.scope as { organizationId?: string; projectId?: string };
        if (!scope.organizationId || !scope.projectId) throw new Error('invalid_export_scope');
        const transactions = await db.ledgerTransaction.findMany({ where: { pool: { projectId: scope.projectId, project: { organizationId: scope.organizationId } } }, include: { entries: { include: { account: { select: { code: true, type: true } } } } }, orderBy: { postedAt: 'asc' }, take: 10_000 });
        lines = ['transaction_id,posted_at,source_type,source_id,reversal_of,currency,account_code,account_type,debit_minor,credit_minor', ...transactions.flatMap(transaction => transaction.entries.map(entry => [transaction.id, transaction.postedAt.toISOString(), transaction.sourceType, transaction.sourceId, transaction.reversalOf, transaction.currency, entry.account.code, entry.account.type, entry.debitMinor, entry.creditMinor].map(csvCell).join(',')))];
        filename = `organization-ledger-${row.id}.csv`;
      } else if (row.kind === 'allocation_book_csv') {
        const scope = row.scope as { organizationId?: string; offeringId?: string };
        if (!scope.organizationId || !scope.offeringId) throw new Error('invalid_export_scope');
        const commitments = await db.commitment.findMany({ where: { offeringId: scope.offeringId, offering: { organizationId: scope.organizationId } }, include: { user: { select: { name: true, email: true } }, allocation: true }, orderBy: { createdAt: 'asc' }, take: 10_000 });
        lines = ['commitment_id,investor_name,investor_email,state,amount_minor,currency,requested_units,allocated_units,allocated_cost_minor,proof_reference,finalised_at', ...commitments.map(item => [item.id, item.user.name, item.user.email, item.state, item.amountMinor, item.currency, item.units, item.allocation?.units, item.allocation?.costMinor, item.allocation?.proofReference, item.allocation?.finalisedAt?.toISOString()].map(csvCell).join(','))];
        filename = `allocation-book-${row.id}.csv`;
      } else if (row.kind === 'applications_csv') {
        const scope = row.scope as { organizationId?: string; applicationId?: string | null };
        if (!scope.organizationId) throw new Error('invalid_export_scope');
        const applications = await db.application.findMany({ where: { program: { organizationId: scope.organizationId }, ...(scope.applicationId ? { id: scope.applicationId } : {}) }, include: { program: { select: { title: true } }, cohort: { select: { name: true } }, user: { select: { name: true, email: true, candidateProfile: true } }, reviews: { orderBy: { createdAt: 'desc' }, take: 1, select: { total: true, scaleMax: true } } }, orderBy: { submittedAt: 'desc' }, take: 10_000 });
        lines = ['reference,state,program,cohort,submitted_at,candidate_name,headline,city,email,latest_score,score_scale', ...applications.map(item => { const shared = item.sharingConsent && item.user.candidateProfile?.shareWithOperators; const profile = shared ? item.user.candidateProfile : null; return [item.reference, item.state, item.program.title, item.cohort.name, item.submittedAt?.toISOString(), shared ? item.user.name : '', profile?.headline, profile?.city, profile?.shareContact ? item.user.email : '', item.reviews[0]?.total, item.reviews[0]?.scaleMax].map(csvCell).join(','); })];
        filename = `applications-${row.id}.csv`;
      } else if (row.kind === 'account_data_json') {
        const user = await db.user.findUniqueOrThrow({ where: { id: row.ownerId }, select: { id: true, email: true, name: true, status: true, termsVersion: true, termsAcceptedAt: true, createdAt: true, profile: true, memberships: { select: { organizationId: true, roles: true, status: true, createdAt: true } }, candidateProfile: true } });
        const party = await db.party.findUnique({ where: { userId: row.ownerId }, select: { id: true } });
        const [contributions, commitments, applications, notifications, tickets] = await Promise.all([
          party ? db.contribution.findMany({ where: { payerPartyId: party.id }, select: { id: true, projectId: true, amountMinor: true, feeMinor: true, refundedMinor: true, currency: true, state: true, visibility: true, confirmedAt: true, createdAt: true } }) : [],
          db.commitment.findMany({ where: { userId: row.ownerId }, select: { id: true, offeringId: true, amountMinor: true, units: true, currency: true, state: true, createdAt: true } }),
          db.application.findMany({ where: { userId: row.ownerId }, select: { id: true, reference: true, programId: true, cohortId: true, state: true, motivation: true, sharingConsent: true, submittedAt: true, decidedAt: true, createdAt: true } }),
          db.userNotification.findMany({ where: { recipientId: row.ownerId }, select: { eventType: true, title: true, body: true, safePath: true, readAt: true, createdAt: true } }),
          db.supportTicket.findMany({ where: { requesterId: row.ownerId }, select: { reference: true, category: true, title: true, state: true, priority: true, createdAt: true, updatedAt: true } })
        ]);
        const json = JSON.stringify({ exportedAt: now.toISOString(), user, contributions, commitments, applications, notifications, tickets }, (_key, value) => typeof value === 'bigint' ? value.toString() : value, 2);
        lines = [json];
        filename = `tamkeen-account-data-${row.id}.json`;
      } else throw new Error('unsupported_export_kind');
      const jsonExport = row.kind === 'account_data_json';
      await db.exportJob.update({ where: { id: row.id }, data: { state: 'ready', filename, mimeType: jsonExport ? 'application/json' : 'text/csv; charset=utf-8', content: jsonExport ? lines[0]! : `\uFEFF${lines.join('\r\n')}`, expiresAt: new Date(now.getTime() + 24 * 60 * 60_000), lastErrorCode: '', version: { increment: 1 } } });
    } catch (error) {
      const attempts = row.attempts + 1;
      await db.exportJob.update({ where: { id: row.id }, data: { state: 'failed', lastErrorCode: error instanceof Error ? error.message.slice(0, 80) : 'export_error', nextAttemptAt: new Date(now.getTime() + Math.min(3_600_000, 30_000 * 2 ** attempts)), version: { increment: 1 } } });
    }
    processed += 1;
  }
  return processed;
}

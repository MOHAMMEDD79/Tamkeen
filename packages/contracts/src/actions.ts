/**
 * The action implementation manifest required by screens/09-ROUTE-AND-ACTION-RESOLUTION.
 *
 * Every button in the screen catalogue carries an action ID. This manifest states, for each ID the
 * product has reached, whether it is implemented and where — or that it is deliberately unavailable
 * and why. 00-MASTER-PROMPT forbids a button that does nothing, so a screen may render a control
 * only if its ID appears here, and a control whose status is `unavailable` must render as a
 * declared, explained state rather than as a live control.
 *
 * PART-14 requires that no in-scope action still sits at `unavailable` except a documented external
 * integration. Until then this file is the honest gap list.
 */

export type ActionStatus =
  /** Implemented and reachable, with a server contract and at least one test. */
  | 'implemented'
  /** Deliberately not built yet. The UI must say so rather than offer a dead control. */
  | 'unavailable';

export interface ActionEntry {
  /** `PAGE-ID.ANN` from the screen catalogue. */
  id: string;
  /** Screen ID that owns the control. */
  page: string;
  /** Locale-free web route the control lives on. */
  route: string;
  /** `NAV`/`LOCAL` for client-side moves, otherwise the HTTP method. */
  method: 'NAV' | 'LOCAL' | 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** OpenAPI path for a server call, or the destination route for NAV. */
  endpoint: string;
  /** Permission the server asserts, or `public`/`self`. */
  permission: string;
  status: ActionStatus;
  /** Which part implemented it, or which part owns it next. */
  part: string;
  /** Test file that covers it. Required when implemented. */
  testRef?: string;
  /** Why it is not available yet. Required when unavailable, and shown to the user in substance. */
  reason?: string;
}

export const ACTION_MANIFEST: readonly ActionEntry[] = [
  // ---- AUTH-01..04 (PART-02) ----------------------------------------------------------------
  { id: 'AUTH-01.A01', page: 'AUTH-01', route: '/login', method: 'POST', endpoint: '/auth/sign-in/email', permission: 'public', status: 'implemented', part: 'PART-02', testRef: 'tests/auth.integration.test.ts' },
  { id: 'AUTH-01.A02', page: 'AUTH-01', route: '/login', method: 'NAV', endpoint: '/recover', permission: 'public', status: 'implemented', part: 'PART-02', testRef: 'tests/return-to.test.ts' },
  { id: 'AUTH-01.A03', page: 'AUTH-01', route: '/login', method: 'NAV', endpoint: '/register', permission: 'public', status: 'implemented', part: 'PART-02', testRef: 'tests/return-to.test.ts' },
  { id: 'AUTH-02.A01', page: 'AUTH-02', route: '/register', method: 'POST', endpoint: '/auth/sign-up/email', permission: 'public', status: 'implemented', part: 'PART-02', testRef: 'tests/auth.integration.test.ts' },
  { id: 'AUTH-02.A02', page: 'AUTH-02', route: '/register', method: 'NAV', endpoint: '/login', permission: 'public', status: 'implemented', part: 'PART-02', testRef: 'tests/return-to.test.ts' },
  { id: 'AUTH-02.A03', page: 'AUTH-02', route: '/register', method: 'NAV', endpoint: '/policies/terms', permission: 'public', status: 'implemented', part: 'PART-02', testRef: 'tests/auth.integration.test.ts' },
  { id: 'AUTH-03.A01', page: 'AUTH-03', route: '/recover', method: 'POST', endpoint: '/auth/email-otp/request-password-reset', permission: 'public', status: 'implemented', part: 'PART-02', testRef: 'tests/auth.integration.test.ts' },
  { id: 'AUTH-03.A02', page: 'AUTH-03', route: '/verify', method: 'POST', endpoint: '/auth/email-otp/send-verification-otp', permission: 'public', status: 'implemented', part: 'PART-02', testRef: 'tests/auth.integration.test.ts' },
  { id: 'AUTH-03.A03', page: 'AUTH-03', route: '/verify', method: 'POST', endpoint: '/auth/email-otp/verify-email', permission: 'token owner', status: 'implemented', part: 'PART-02', testRef: 'tests/auth.integration.test.ts' },
  { id: 'AUTH-03.A04', page: 'AUTH-03', route: '/recover', method: 'POST', endpoint: '/auth/email-otp/reset-password', permission: 'token owner', status: 'implemented', part: 'PART-02', testRef: 'tests/auth.integration.test.ts' },
  { id: 'AUTH-04.A01', page: 'AUTH-04', route: '/onboarding', method: 'PATCH', endpoint: '/me/profile', permission: 'profile.manage', status: 'implemented', part: 'PART-02', testRef: 'tests/identity.integration.test.ts' },
  { id: 'AUTH-04.A02', page: 'AUTH-04', route: '/onboarding', method: 'PATCH', endpoint: '/me/profile', permission: 'profile.manage', status: 'implemented', part: 'PART-02', testRef: 'tests/identity.integration.test.ts' },
  { id: 'AUTH-04.A03', page: 'AUTH-04', route: '/onboarding', method: 'NAV', endpoint: '/app', permission: 'self', status: 'implemented', part: 'PART-02', testRef: 'tests/return-to.test.ts' },

  // ---- PER-01 personal home (PART-03 rebuilds the screen; its data pages come later) ---------
  { id: 'PER-01.A01', page: 'PER-01', route: '/app', method: 'NAV', endpoint: '/app/contributions', permission: 'self', status: 'implemented', part: 'PART-06', testRef: 'tests/route-resolution.test.ts' },
  { id: 'PER-01.A02', page: 'PER-01', route: '/app', method: 'NAV', endpoint: '/app/investments', permission: 'self', status: 'implemented', part: 'PART-09', testRef: 'tests/route-resolution.test.ts' },
  { id: 'PER-01.A03', page: 'PER-01', route: '/app', method: 'NAV', endpoint: '/app/applications', permission: 'self', status: 'implemented', part: 'PART-10', testRef: 'tests/programs.integration.test.ts' },
  { id: 'PER-01.A04', page: 'PER-01', route: '/app', method: 'POST', endpoint: '/me/context', permission: 'self', status: 'implemented', part: 'PART-02', testRef: 'tests/identity.integration.test.ts' },

  // ---- PER-18 personal settings and security ------------------------------------------------
  { id: 'PER-18.A01', page: 'PER-18', route: '/app/settings', method: 'PATCH', endpoint: '/me/profile', permission: 'profile.manage', status: 'implemented', part: 'PART-02', testRef: 'tests/identity.integration.test.ts' },
  { id: 'PER-18.A02', page: 'PER-18', route: '/app/settings', method: 'POST', endpoint: '/sessions/{id}/revoke', permission: 'self', status: 'implemented', part: 'PART-02', testRef: 'tests/identity.integration.test.ts' },
  { id: 'PER-18.A03', page: 'PER-18', route: '/app/settings', method: 'POST', endpoint: '/auth/two-factor/enable', permission: 'self', status: 'implemented', part: 'PART-02', testRef: 'tests/auth.integration.test.ts' },
  { id: 'PER-18.A04', page: 'PER-18', route: '/app/settings', method: 'POST', endpoint: '/me/data-exports', permission: 'self', status: 'implemented', part: 'PART-13', testRef: 'tests/operations.integration.test.ts' },
  { id: 'PER-18.A05', page: 'PER-18', route: '/app/settings', method: 'POST', endpoint: '/me/closure-requests', permission: 'self', status: 'unavailable', part: 'PART-13', reason: 'Closing an account must first show outstanding obligations, which depend on the money and programme modules.' },

  // ---- ORG-01..05 (PART-02) ------------------------------------------------------------------
  { id: 'ORG-01.A01', page: 'ORG-01', route: '/app/organizations/new', method: 'POST', endpoint: '/orgs', permission: 'self', status: 'implemented', part: 'PART-02', testRef: 'tests/identity.integration.test.ts' },
  { id: 'ORG-01.A02', page: 'ORG-01', route: '/app/organizations/new', method: 'LOCAL', endpoint: 'localStorage draft', permission: 'self', status: 'implemented', part: 'PART-02', testRef: 'tests/identity.integration.test.ts' },
  { id: 'ORG-01.A03', page: 'ORG-01', route: '/app/organizations/new', method: 'NAV', endpoint: '/org/{id}/verification', permission: 'organization.manage', status: 'implemented', part: 'PART-02', testRef: 'tests/identity.integration.test.ts' },
  { id: 'ORG-02.A04', page: 'ORG-02', route: '/org/{id}/team', method: 'GET', endpoint: '/orgs/{id}/members', permission: 'member.read', status: 'implemented', part: 'PART-02', testRef: 'tests/identity.integration.test.ts' },
  { id: 'ORG-03.A01', page: 'ORG-03', route: '/org/{id}/settings', method: 'PATCH', endpoint: '/orgs/{id}', permission: 'organization.manage', status: 'implemented', part: 'PART-02', testRef: 'tests/identity.integration.test.ts' },
  { id: 'ORG-03.A02', page: 'ORG-03', route: '/org/{id}/settings', method: 'GET', endpoint: '/orgs/{id}/public-preview', permission: 'organization.manage', status: 'implemented', part: 'PART-02', testRef: 'tests/identity.integration.test.ts' },
  { id: 'ORG-03.A03', page: 'ORG-03', route: '/org/{id}/settings', method: 'POST', endpoint: '/orgs/{id}/bank-change-requests', permission: 'bank.manage', status: 'implemented', part: 'PART-02', testRef: 'tests/bank-change.integration.test.ts' },
  { id: 'ORG-03.A04', page: 'ORG-03', route: '/org/{id}/settings', method: 'POST', endpoint: '/orgs/{id}/ownership-transfers', permission: 'ownership.transfer', status: 'implemented', part: 'PART-02', testRef: 'tests/identity.integration.test.ts' },
  { id: 'ORG-04.A01', page: 'ORG-04', route: '/org/{id}/verification', method: 'PATCH', endpoint: '/orgs/{id}/verification', permission: 'organization.manage', status: 'implemented', part: 'PART-02', testRef: 'tests/identity.integration.test.ts' },
  { id: 'ORG-04.A02', page: 'ORG-04', route: '/org/{id}/verification', method: 'POST', endpoint: '/orgs/{id}/verification/submissions', permission: 'organization.manage', status: 'implemented', part: 'PART-02', testRef: 'tests/auth.integration.test.ts' },
  { id: 'ORG-04.A03', page: 'ORG-04', route: '/org/{id}/verification', method: 'POST', endpoint: '/orgs/{id}/verification/submissions', permission: 'organization.manage', status: 'implemented', part: 'PART-02', testRef: 'tests/identity.integration.test.ts' },
  { id: 'ORG-04.A04', page: 'ORG-04', route: '/org/{id}/verification', method: 'GET', endpoint: '/orgs/{id}/verification/decisions', permission: 'organization.manage', status: 'implemented', part: 'PART-02', testRef: 'tests/identity.integration.test.ts' },
  { id: 'ORG-05.A01', page: 'ORG-05', route: '/org/{id}/team', method: 'POST', endpoint: '/orgs/{id}/invitations', permission: 'member.invite', status: 'implemented', part: 'PART-02', testRef: 'tests/identity.integration.test.ts' },
  { id: 'ORG-05.A02', page: 'ORG-05', route: '/org/{id}/team', method: 'PATCH', endpoint: '/orgs/{id}/members/{userId}', permission: 'member.role.update', status: 'implemented', part: 'PART-02', testRef: 'tests/identity.integration.test.ts' },
  { id: 'ORG-05.A03', page: 'ORG-05', route: '/org/{id}/team', method: 'PATCH', endpoint: '/orgs/{id}/members/{userId}', permission: 'member.role.update', status: 'implemented', part: 'PART-02', testRef: 'tests/identity.integration.test.ts' },
  { id: 'ORG-05.A04', page: 'ORG-05', route: '/org/{id}/team', method: 'POST', endpoint: '/orgs/{id}/invitations/{invitationId}/revoke', permission: 'member.invite', status: 'implemented', part: 'PART-02', testRef: 'tests/identity.integration.test.ts' },

  // ---- Supporting screens --------------------------------------------------------------------
  { id: 'SUP-01.A01', page: 'SUP-01', route: '/invitations/{token}', method: 'GET', endpoint: '/invitations/{token}', permission: 'token owner', status: 'implemented', part: 'PART-02', testRef: 'tests/identity.integration.test.ts' },
  { id: 'SUP-01.A02', page: 'SUP-01', route: '/invitations/{token}', method: 'POST', endpoint: '/invitations/{token}/accept', permission: 'token owner', status: 'implemented', part: 'PART-02', testRef: 'tests/identity.integration.test.ts' },
  { id: 'SUP-01.A03', page: 'SUP-01', route: '/invitations/{token}', method: 'POST', endpoint: '/invitations/{token}/decline', permission: 'token owner', status: 'implemented', part: 'PART-02', testRef: 'tests/identity.integration.test.ts' },
  { id: 'SUP-02.A01', page: 'SUP-02', route: '/mfa/challenge', method: 'POST', endpoint: '/auth/mfa/challenges/{challengeId}/verify', permission: 'self', status: 'implemented', part: 'PART-02', testRef: 'tests/identity.integration.test.ts' },
  { id: 'SUP-02.A02', page: 'SUP-02', route: '/mfa/challenge', method: 'POST', endpoint: '/auth/mfa/challenges/{challengeId}/recovery-verify', permission: 'self', status: 'implemented', part: 'PART-02', testRef: 'tests/identity.integration.test.ts' },
  { id: 'SUP-02.A03', page: 'SUP-02', route: '/mfa/challenge', method: 'POST', endpoint: '/auth/mfa/challenges/{challengeId}/cancel', permission: 'self', status: 'implemented', part: 'PART-02', testRef: 'tests/identity.integration.test.ts' },

  // ---- Admin ---------------------------------------------------------------------------------
  { id: 'ADM-02.A01', page: 'ADM-02', route: '/admin/verifications', method: 'GET', endpoint: '/admin/verifications', permission: 'verification.review', status: 'implemented', part: 'PART-02', testRef: 'tests/identity.integration.test.ts' },
  { id: 'ADM-02.A02', page: 'ADM-02', route: '/admin/verifications/{id}', method: 'POST', endpoint: '/admin/verifications/{submissionId}/claim', permission: 'verification.review', status: 'implemented', part: 'PART-02', testRef: 'tests/identity.integration.test.ts' },
  { id: 'ADM-02.A03', page: 'ADM-02', route: '/admin/verifications/{id}', method: 'POST', endpoint: '/admin/verifications/{submissionId}/decision', permission: 'verification.review', status: 'implemented', part: 'PART-02', testRef: 'tests/identity.integration.test.ts' },
  { id: 'ADM-08.A01', page: 'ADM-08', route: '/admin/audit', method: 'GET', endpoint: '/admin/audit/{id}', permission: 'audit.read', status: 'implemented', part: 'PART-13', testRef: 'tests/operations.integration.test.ts' },
  { id: 'ADM-08.A02', page: 'ADM-08', route: '/admin/audit', method: 'POST', endpoint: '/admin/audit-exports', permission: 'audit.export', status: 'implemented', part: 'PART-13', testRef: 'tests/operations.integration.test.ts' },
  { id: 'ADM-08.A03', page: 'ADM-08', route: '/admin/team', method: 'POST', endpoint: '/admin/team/invitations', permission: 'PlatformAdmin', status: 'implemented', part: 'PART-02', testRef: 'tests/identity.integration.test.ts' },
  { id: 'ADM-08.A04', page: 'ADM-08', route: '/admin/team', method: 'POST', endpoint: '/admin/team/{userId}/grants', permission: 'PlatformAdmin', status: 'implemented', part: 'PART-02', testRef: 'tests/identity.integration.test.ts' },
  { id: 'ADM-08.A05', page: 'ADM-08', route: '/admin/team', method: 'POST', endpoint: '/admin/team/{userId}/revoke', permission: 'PlatformAdmin', status: 'implemented', part: 'PART-02', testRef: 'tests/identity.integration.test.ts' },

  // ---- PART-04: public browsing, projects and the map -----------------------------------------
  { id: 'PUB-01.A01', page: 'PUB-01', route: '/', method: 'NAV', endpoint: '/explore', permission: 'public', status: 'implemented', part: 'PART-04', testRef: 'tests/public-surface.integration.test.ts' },
  { id: 'PUB-01.A02', page: 'PUB-01', route: '/', method: 'NAV', endpoint: '/invest', permission: 'public', status: 'implemented', part: 'PART-04', testRef: 'tests/public-surface.integration.test.ts' },
  { id: 'PUB-01.A03', page: 'PUB-01', route: '/', method: 'NAV', endpoint: '/opportunities', permission: 'public', status: 'implemented', part: 'PART-04', testRef: 'tests/public-surface.integration.test.ts' },
  { id: 'PUB-01.A04', page: 'PUB-01', route: '/', method: 'NAV', endpoint: '/app/organizations/new', permission: 'self', status: 'implemented', part: 'PART-02', testRef: 'tests/identity.integration.test.ts' },

  { id: 'PUB-02.A01', page: 'PUB-02', route: '/explore', method: 'GET', endpoint: '/projects', permission: 'public', status: 'implemented', part: 'PART-04', testRef: 'tests/projects.integration.test.ts' },
  { id: 'PUB-02.A02', page: 'PUB-02', route: '/explore', method: 'NAV', endpoint: '/map', permission: 'public', status: 'implemented', part: 'PART-04', testRef: 'tests/public-surface.integration.test.ts' },
  { id: 'PUB-02.A03', page: 'PUB-02', route: '/explore', method: 'POST', endpoint: '/bookmarks', permission: 'self', status: 'implemented', part: 'PART-04', testRef: 'tests/projects.integration.test.ts' },
  { id: 'PUB-02.A04', page: 'PUB-02', route: '/explore', method: 'DELETE', endpoint: '/bookmarks/{id}', permission: 'self', status: 'implemented', part: 'PART-04', testRef: 'tests/projects.integration.test.ts' },

  { id: 'PUB-03.A01', page: 'PUB-03', route: '/map', method: 'GET', endpoint: '/map/projects', permission: 'public', status: 'implemented', part: 'PART-04', testRef: 'tests/public-projection.test.ts' },
  { id: 'PUB-03.A02', page: 'PUB-03', route: '/map', method: 'NAV', endpoint: '/projects/{slug}', permission: 'public', status: 'implemented', part: 'PART-04', testRef: 'tests/public-surface.integration.test.ts' },
  { id: 'PUB-03.A03', page: 'PUB-03', route: '/map', method: 'GET', endpoint: '/map/projects', permission: 'public', status: 'implemented', part: 'PART-04', testRef: 'tests/projects.integration.test.ts' },
  { id: 'PUB-03.A04', page: 'PUB-03', route: '/map', method: 'LOCAL', endpoint: 'browser geolocation', permission: 'public', status: 'unavailable', part: 'PART-13', reason: 'Device geolocation is only meaningful with an interactive map, and no map provider or tile licence has been decided yet.' },

  { id: 'PUB-04.A01', page: 'PUB-04', route: '/organizations', method: 'NAV', endpoint: '/organizations/{slug}', permission: 'public', status: 'implemented', part: 'PART-04', testRef: 'tests/public-surface.integration.test.ts' },
  { id: 'PUB-04.A02', page: 'PUB-04', route: '/organizations', method: 'GET', endpoint: '/organizations', permission: 'public', status: 'implemented', part: 'PART-04', testRef: 'tests/public-projection.test.ts' },
  { id: 'PUB-04.A03', page: 'PUB-04', route: '/organizations', method: 'NAV', endpoint: '/organizations', permission: 'public', status: 'implemented', part: 'PART-04', testRef: 'tests/public-surface.integration.test.ts' },

  { id: 'PUB-05.A01', page: 'PUB-05', route: '/organizations/{slug}', method: 'NAV', endpoint: '/explore', permission: 'public', status: 'implemented', part: 'PART-04', testRef: 'tests/public-surface.integration.test.ts' },
  { id: 'PUB-05.A02', page: 'PUB-05', route: '/organizations/{slug}', method: 'POST', endpoint: '/follows', permission: 'self', status: 'implemented', part: 'PART-13', testRef: 'tests/operations.integration.test.ts' },
  { id: 'PUB-05.A03', page: 'PUB-05', route: '/organizations/{slug}', method: 'GET', endpoint: '/public-reports/{id}/download', permission: 'public', status: 'implemented', part: 'PART-13', testRef: 'tests/charity-lifecycle.integration.test.ts' },
  { id: 'PUB-05.A04', page: 'PUB-05', route: '/organizations/{slug}', method: 'NAV', endpoint: '/orgs/{id}/agreements/new', permission: 'organization.manage', status: 'unavailable', part: 'PART-12', reason: 'Partnership agreements between two organisations are not modelled yet.' },
  { id: 'PUB-05.A05', page: 'PUB-05', route: '/organizations/{slug}', method: 'POST', endpoint: '/tickets', permission: 'self', status: 'implemented', part: 'PART-13', testRef: 'tests/operations.integration.test.ts' },

  { id: 'PUB-06.A02', page: 'PUB-06', route: '/projects/{slug}', method: 'POST', endpoint: '/follows', permission: 'self', status: 'implemented', part: 'PART-13', testRef: 'tests/operations.integration.test.ts' },
  { id: 'PUB-06.A03', page: 'PUB-06', route: '/projects/{slug}', method: 'LOCAL', endpoint: 'copy canonical url', permission: 'public', status: 'implemented', part: 'PART-04', testRef: 'tests/public-surface.integration.test.ts' },
  { id: 'PUB-06.A04', page: 'PUB-06', route: '/projects/{slug}', method: 'GET', endpoint: '/projects/{id}/reports', permission: 'public', status: 'unavailable', part: 'PART-07', reason: 'Delivery evidence and reviewed reports do not exist until the disbursement and impact review loop is built.' },
  { id: 'PUB-06.A05', page: 'PUB-06', route: '/projects/{slug}', method: 'POST', endpoint: '/tickets', permission: 'self', status: 'implemented', part: 'PART-13', testRef: 'tests/operations.integration.test.ts' },

  { id: 'PUB-12.A01', page: 'PUB-12', route: '/impact', method: 'GET', endpoint: '/impact', permission: 'public', status: 'implemented', part: 'PART-04', testRef: 'tests/projects.integration.test.ts' },
  { id: 'PUB-12.A02', page: 'PUB-12', route: '/impact', method: 'NAV', endpoint: '/impact/reports/{id}', permission: 'public', status: 'implemented', part: 'PART-13', testRef: 'tests/charity-lifecycle.integration.test.ts' },
  { id: 'PUB-12.A03', page: 'PUB-12', route: '/impact', method: 'GET', endpoint: '/public-reports/{id}/download', permission: 'public', status: 'implemented', part: 'PART-13', testRef: 'tests/charity-lifecycle.integration.test.ts' },

  { id: 'PUB-13.A01', page: 'PUB-13', route: '/about', method: 'NAV', endpoint: '/contact', permission: 'public', status: 'implemented', part: 'PART-13', testRef: 'tests/route-resolution.test.ts' },
  { id: 'PUB-13.A02', page: 'PUB-13', route: '/about', method: 'GET', endpoint: '/policies/{slug}/versions/{version}', permission: 'public', status: 'implemented', part: 'PART-13', testRef: 'tests/operations.integration.test.ts' },
  { id: 'PUB-13.A03', page: 'PUB-13', route: '/about', method: 'NAV', endpoint: '/explore', permission: 'public', status: 'implemented', part: 'PART-04', testRef: 'tests/public-surface.integration.test.ts' },

  { id: 'ORG-06.A01', page: 'ORG-06', route: '/org/{id}/projects', method: 'NAV', endpoint: '/org/{id}/projects/new', permission: 'project.create', status: 'implemented', part: 'PART-04', testRef: 'tests/projects.integration.test.ts' },
  { id: 'ORG-06.A02', page: 'ORG-06', route: '/org/{id}/projects', method: 'GET', endpoint: '/orgs/{id}/projects/{projectId}', permission: 'project.read', status: 'implemented', part: 'PART-04', testRef: 'tests/projects.integration.test.ts' },
  { id: 'ORG-06.A03', page: 'ORG-06', route: '/org/{id}/projects', method: 'POST', endpoint: '/orgs/{id}/projects/{projectId}/duplicate', permission: 'project.create', status: 'implemented', part: 'PART-04', testRef: 'tests/projects.integration.test.ts' },
  { id: 'ORG-06.A04', page: 'ORG-06', route: '/org/{id}/projects', method: 'POST', endpoint: '/orgs/{id}/projects/{projectId}/archive', permission: 'project.archive', status: 'unavailable', part: 'PART-07', reason: 'Archiving requires a closed project with completed financial settlement, which depends on the ledger.' },

  { id: 'ORG-07.A01', page: 'ORG-07', route: '/org/{id}/projects/new', method: 'POST', endpoint: '/orgs/{id}/projects', permission: 'project.create', status: 'implemented', part: 'PART-04', testRef: 'tests/projects.integration.test.ts' },
  { id: 'ORG-07.A02', page: 'ORG-07', route: '/org/{id}/projects/new', method: 'PUT', endpoint: '/orgs/{id}/projects/{projectId}/milestones', permission: 'project.update', status: 'implemented', part: 'PART-05', testRef: 'tests/charity-lifecycle.integration.test.ts' },
  { id: 'ORG-07.A03', page: 'ORG-07', route: '/org/{id}/projects/new', method: 'GET', endpoint: '/orgs/{id}/projects/{projectId}/public-preview', permission: 'project.read', status: 'implemented', part: 'PART-04', testRef: 'tests/projects.integration.test.ts' },
  { id: 'ORG-07.A04', page: 'ORG-07', route: '/org/{id}/projects/new', method: 'POST', endpoint: '/orgs/{id}/projects/{projectId}/submit', permission: 'project.submit', status: 'implemented', part: 'PART-04', testRef: 'tests/projects.integration.test.ts' },

  // ---- PART-05: campaigns, budgets, milestones, reports and content review --------------------
  { id: 'ORG-08.A01', page: 'ORG-08', route: '/org/{id}/projects/{projectId}', method: 'POST', endpoint: '/orgs/{id}/projects/{projectId}/updates', permission: 'report.publish', status: 'implemented', part: 'PART-05', testRef: 'tests/charity-lifecycle.integration.test.ts' },
  { id: 'ORG-08.A02', page: 'ORG-08', route: '/org/{id}/projects/{projectId}', method: 'POST', endpoint: '/orgs/{id}/projects/{projectId}/milestones/{milestoneId}/evidence', permission: 'project.update', status: 'implemented', part: 'PART-05', testRef: 'tests/charity-lifecycle.integration.test.ts' },
  { id: 'ORG-08.A03', page: 'ORG-08', route: '/org/{id}/projects/{projectId}', method: 'POST', endpoint: '/orgs/{id}/projects/{projectId}/pause', permission: 'project.pause', status: 'implemented', part: 'PART-05', testRef: 'tests/charity-lifecycle.integration.test.ts' },
  { id: 'ORG-08.A04', page: 'ORG-08', route: '/org/{id}/projects/{projectId}', method: 'POST', endpoint: '/orgs/{id}/projects/{projectId}/close', permission: 'project.close', status: 'implemented', part: 'PART-05', testRef: 'tests/charity-lifecycle.integration.test.ts' },
  { id: 'ORG-08.A05', page: 'ORG-08', route: '/org/{id}/projects/{projectId}', method: 'PUT', endpoint: '/orgs/{id}/projects/{projectId}/budget', permission: 'project.update', status: 'implemented', part: 'PART-05', testRef: 'tests/charity-lifecycle.integration.test.ts' },

  { id: 'ORG-13.A01', page: 'ORG-13', route: '/org/{id}/projects/{projectId}', method: 'POST', endpoint: '/orgs/{id}/projects/{projectId}/reports', permission: 'report.create', status: 'implemented', part: 'PART-05', testRef: 'tests/charity-lifecycle.integration.test.ts' },
  { id: 'ORG-13.A02', page: 'ORG-13', route: '/org/{id}/projects/{projectId}', method: 'GET', endpoint: '/orgs/{id}/projects/{projectId}/report-metrics', permission: 'report.create', status: 'implemented', part: 'PART-05', testRef: 'tests/charity-lifecycle.integration.test.ts' },
  { id: 'ORG-13.A03', page: 'ORG-13', route: '/org/{id}/projects/{projectId}', method: 'POST', endpoint: '/orgs/{id}/reports/{reportId}/submit', permission: 'report.submit', status: 'implemented', part: 'PART-05', testRef: 'tests/charity-lifecycle.integration.test.ts' },
  { id: 'ORG-13.A04', page: 'ORG-13', route: '/org/{id}/projects/{projectId}', method: 'GET', endpoint: '/documents/{id}/download', permission: 'report.read', status: 'unavailable', part: 'PART-13', reason: 'Report attachments need the document store and its classification checks, which exist only for verification documents so far.' },
  { id: 'ORG-13.A05', page: 'ORG-13', route: '/org/{id}/projects/{projectId}', method: 'POST', endpoint: '/orgs/{id}/reports/{reportId}/publish', permission: 'report.publish', status: 'implemented', part: 'PART-05', testRef: 'tests/charity-lifecycle.integration.test.ts' },

  { id: 'ADM-03.A01', page: 'ADM-03', route: '/admin/reviews/project/{versionId}', method: 'POST', endpoint: '/admin/reviews/project/{versionId}/decision', permission: 'content.review', status: 'implemented', part: 'PART-05', testRef: 'tests/charity-lifecycle.integration.test.ts' },
  { id: 'ADM-03.A02', page: 'ADM-03', route: '/admin/reviews/project/{versionId}', method: 'POST', endpoint: '/admin/reviews/project/{versionId}/decision', permission: 'content.review', status: 'implemented', part: 'PART-05', testRef: 'tests/charity-lifecycle.integration.test.ts' },
  { id: 'ADM-03.A03', page: 'ADM-03', route: '/admin/reviews/project/{versionId}', method: 'POST', endpoint: '/admin/reviews/project/{versionId}/decision', permission: 'content.review', status: 'implemented', part: 'PART-05', testRef: 'tests/charity-lifecycle.integration.test.ts' },
  { id: 'ADM-03.A04', page: 'ADM-03', route: '/admin/reviews/project/{versionId}', method: 'GET', endpoint: '/admin/reviews/project/{versionId}', permission: 'content.review', status: 'implemented', part: 'PART-05', testRef: 'tests/charity-lifecycle.integration.test.ts' },

  { id: 'ADM-01.A01', page: 'ADM-01', route: '/admin/reviews/project', method: 'POST', endpoint: '/admin/reviews/project/{versionId}/claim', permission: 'content.review', status: 'implemented', part: 'PART-05', testRef: 'tests/charity-lifecycle.integration.test.ts' },
  { id: 'ADM-01.A02', page: 'ADM-01', route: '/admin/reviews/project', method: 'NAV', endpoint: '/admin/reviews/project/{versionId}', permission: 'content.review', status: 'implemented', part: 'PART-05', testRef: 'tests/charity-lifecycle.integration.test.ts' },
  { id: 'ADM-01.A03', page: 'ADM-01', route: '/admin/reviews/project', method: 'POST', endpoint: '/admin/tasks/{id}/assign', permission: 'review.assign', status: 'implemented', part: 'PART-13', testRef: 'tests/charity-lifecycle.integration.test.ts' },

  // ---- PART-06: contributions, the simulated payment path and the ledger ----------------------
  // PUB-06.A01 is a NAV: the button only appears where the server said the campaign accepts money,
  // and the checkout re-checks capacity, so the control is never a promise the server will refuse.
  { id: 'PUB-06.A01', page: 'PUB-06', route: '/projects/{slug}', method: 'NAV', endpoint: '/checkout/{slug}', permission: 'contribution.create', status: 'implemented', part: 'PART-06', testRef: 'tests/route-resolution.test.ts' },

  { id: 'PER-04.A01', page: 'PER-04', route: '/checkout/{slug}', method: 'POST', endpoint: '/contributions', permission: 'contribution.create', status: 'implemented', part: 'PART-06', testRef: 'tests/money-ledger.integration.test.ts' },
  { id: 'PER-04.A02', page: 'PER-04', route: '/checkout/{slug}', method: 'GET', endpoint: '/projects/{slug}/quote', permission: 'public', status: 'implemented', part: 'PART-06', testRef: 'tests/money-ledger.integration.test.ts' },
  { id: 'PER-04.A03', page: 'PER-04', route: '/checkout/{slug}', method: 'NAV', endpoint: '/projects/{slug}', permission: 'public', status: 'implemented', part: 'PART-06', testRef: 'tests/route-resolution.test.ts' },

  { id: 'PER-05.A01', page: 'PER-05', route: '/payments/{intentId}', method: 'GET', endpoint: '/payment-intents/{id}/status', permission: 'self', status: 'implemented', part: 'PART-06', testRef: 'tests/money-ledger.integration.test.ts' },
  { id: 'PER-05.A02', page: 'PER-05', route: '/payments/{intentId}', method: 'NAV', endpoint: '/app/contributions', permission: 'self', status: 'implemented', part: 'PART-06', testRef: 'tests/route-resolution.test.ts' },
  { id: 'PER-05.A03', page: 'PER-05', route: '/payments/{intentId}', method: 'POST', endpoint: '/payment-intents/{id}/retry', permission: 'self', status: 'unavailable', part: 'PART-13', reason: 'Retrying needs an attempt chain bound to one contribution so a successful charge can never be repeated. PART-07 built the safe way out of a lost outcome — a provider inquiry — and starting a fresh contribution is the supported path meanwhile.' },
  { id: 'PER-05.A04', page: 'PER-05', route: '/payments/{intentId}', method: 'POST', endpoint: '/tickets', permission: 'self', status: 'implemented', part: 'PART-13', testRef: 'tests/operations.integration.test.ts' },

  { id: 'PER-02.A01', page: 'PER-02', route: '/app/contributions', method: 'GET', endpoint: '/me/contributions', permission: 'self', status: 'implemented', part: 'PART-06', testRef: 'tests/money-ledger.integration.test.ts' },
  { id: 'PER-02.A02', page: 'PER-02', route: '/app/contributions', method: 'POST', endpoint: '/me/contribution-exports', permission: 'self', status: 'implemented', part: 'PART-13', testRef: 'tests/operations.integration.test.ts' },
  { id: 'PER-02.A03', page: 'PER-02', route: '/app/contributions', method: 'NAV', endpoint: '/checkout/{slug}', permission: 'contribution.create', status: 'implemented', part: 'PART-06', testRef: 'tests/route-resolution.test.ts' },

  { id: 'PER-03.A01', page: 'PER-03', route: '/app/contributions', method: 'GET', endpoint: '/contributions/{id}/receipt', permission: 'self', status: 'implemented', part: 'PART-13', testRef: 'tests/money-ledger.integration.test.ts' },
  { id: 'PER-03.A02', page: 'PER-03', route: '/app/contributions', method: 'PATCH', endpoint: '/me/contributions/{id}/privacy', permission: 'self', status: 'implemented', part: 'PART-06', testRef: 'tests/money-ledger.integration.test.ts' },
  { id: 'PER-03.A03', page: 'PER-03', route: '/app/contributions', method: 'POST', endpoint: '/contributions/{id}/refund-requests', permission: 'self', status: 'implemented', part: 'PART-07', testRef: 'tests/payouts-refunds.integration.test.ts' },
  { id: 'PER-03.A04', page: 'PER-03', route: '/app/contributions', method: 'POST', endpoint: '/tickets', permission: 'self', status: 'implemented', part: 'PART-13', testRef: 'tests/operations.integration.test.ts' },
  { id: 'PER-03.A05', page: 'PER-03', route: '/app/contributions', method: 'NAV', endpoint: '/projects/{slug}', permission: 'public', status: 'implemented', part: 'PART-06', testRef: 'tests/route-resolution.test.ts' },

  { id: 'ORG-09.A01', page: 'ORG-09', route: '/org/{id}/projects/{projectId}/finance', method: 'GET', endpoint: '/orgs/{id}/projects/{projectId}/finance', permission: 'finance.read', status: 'implemented', part: 'PART-06', testRef: 'tests/money-ledger.integration.test.ts' },
  { id: 'ORG-09.A02', page: 'ORG-09', route: '/org/{id}/projects/{projectId}/finance', method: 'POST', endpoint: '/orgs/{id}/contribution-exports', permission: 'finance.export', status: 'implemented', part: 'PART-13', testRef: 'tests/money-ledger.integration.test.ts' },
  { id: 'ORG-09.A03', page: 'ORG-09', route: '/org/{id}/projects/{projectId}/finance', method: 'POST', endpoint: '/orgs/{id}/contributions/{cid}/identity-access', permission: 'contribution.identity.read', status: 'unavailable', part: 'PART-13', reason: 'Revealing a contributor identity needs a recorded reason and a time-boxed audited grant. PART-07 kept identity out of every finance read rather than adding a way in; the grant model belongs with the wider operations and audit work.' },
  { id: 'ORG-09.A04', page: 'ORG-09', route: '/org/{id}/projects/{projectId}/finance', method: 'POST', endpoint: '/contributions/{id}/refund-requests', permission: 'refund.request', status: 'implemented', part: 'PART-07', testRef: 'tests/payouts-refunds.integration.test.ts' },

  { id: 'ORG-10.A01', page: 'ORG-10', route: '/org/{id}/projects/{projectId}/finance', method: 'GET', endpoint: '/orgs/{id}/projects/{projectId}/finance', permission: 'finance.read', status: 'implemented', part: 'PART-06', testRef: 'tests/money-ledger.integration.test.ts' },
  { id: 'ORG-10.A02', page: 'ORG-10', route: '/org/{id}/projects/{projectId}/finance', method: 'GET', endpoint: '/orgs/{id}/projects/{projectId}/finance', permission: 'finance.read', status: 'implemented', part: 'PART-06', testRef: 'tests/money-ledger.integration.test.ts' },
  { id: 'ORG-10.A03', page: 'ORG-10', route: '/org/{id}/projects/{projectId}/finance', method: 'NAV', endpoint: '/org/{id}/payouts/new', permission: 'payout.request', status: 'implemented', part: 'PART-07', testRef: 'tests/route-resolution.test.ts' },
  { id: 'ORG-10.A04', page: 'ORG-10', route: '/org/{id}/projects/{projectId}/finance', method: 'POST', endpoint: '/orgs/{id}/ledger-exports', permission: 'finance.export', status: 'implemented', part: 'PART-13', testRef: 'tests/money-ledger.integration.test.ts' },

  // ---- PART-07: disbursement, refunds, reconciliation and closing the loop ---------------------
  { id: 'ORG-11.A01', page: 'ORG-11', route: '/org/{id}/payouts/new', method: 'LOCAL', endpoint: '/org/{id}/payouts/new', permission: 'payout.request', status: 'implemented', part: 'PART-07', testRef: 'tests/route-resolution.test.ts' },
  { id: 'ORG-11.A02', page: 'ORG-11', route: '/org/{id}/payouts/new', method: 'POST', endpoint: '/orgs/{id}/payouts', permission: 'payout.request', status: 'implemented', part: 'PART-07', testRef: 'tests/payouts-refunds.integration.test.ts' },
  { id: 'ORG-11.A03', page: 'ORG-11', route: '/org/{id}/payouts/new', method: 'LOCAL', endpoint: '/org/{id}/payouts', permission: 'payout.request', status: 'implemented', part: 'PART-07', testRef: 'tests/route-resolution.test.ts' },

  { id: 'ORG-12.A01', page: 'ORG-12', route: '/org/{id}/payouts/{payoutId}', method: 'POST', endpoint: '/payouts/{id}/approve', permission: 'payout.approve', status: 'implemented', part: 'PART-07', testRef: 'tests/payouts-refunds.integration.test.ts' },
  { id: 'ORG-12.A02', page: 'ORG-12', route: '/org/{id}/payouts/{payoutId}', method: 'POST', endpoint: '/payouts/{id}/reject', permission: 'payout.approve', status: 'implemented', part: 'PART-07', testRef: 'tests/payouts-refunds.integration.test.ts' },
  { id: 'ORG-12.A03', page: 'ORG-12', route: '/org/{id}/payouts/{payoutId}', method: 'POST', endpoint: '/payouts/{id}/withdraw', permission: 'payout.request', status: 'implemented', part: 'PART-07', testRef: 'tests/payouts-refunds.integration.test.ts' },
  { id: 'ORG-12.A04', page: 'ORG-12', route: '/org/{id}/payouts/{payoutId}', method: 'GET', endpoint: '/payouts/{id}', permission: 'finance.read', status: 'implemented', part: 'PART-07', testRef: 'tests/payouts-refunds.integration.test.ts' },
  { id: 'ORG-12.A05', page: 'ORG-12', route: '/org/{id}/payouts/{payoutId}', method: 'GET', endpoint: '/payouts/{id}', permission: 'finance.read', status: 'implemented', part: 'PART-07', testRef: 'tests/payouts-refunds.integration.test.ts' },

  { id: 'ADM-05.A01', page: 'ADM-05', route: '/admin/finance', method: 'POST', endpoint: '/admin/reconciliation/imports', permission: 'reconciliation.manage', status: 'implemented', part: 'PART-07', testRef: 'tests/payouts-refunds.integration.test.ts' },
  { id: 'ADM-05.A02', page: 'ADM-05', route: '/admin/finance', method: 'POST', endpoint: '/admin/reconciliation/{id}/run', permission: 'reconciliation.manage', status: 'implemented', part: 'PART-07', testRef: 'tests/payouts-refunds.integration.test.ts' },
  { id: 'ADM-05.A03', page: 'ADM-05', route: '/admin/finance', method: 'POST', endpoint: '/admin/reconciliation/items/{id}/resolutions', permission: 'reconciliation.manage', status: 'implemented', part: 'PART-07', testRef: 'tests/payouts-refunds.integration.test.ts' },
  { id: 'ADM-05.A04', page: 'ADM-05', route: '/admin/finance', method: 'POST', endpoint: '/admin/payouts/{id}/inquire', permission: 'payment.inquire', status: 'implemented', part: 'PART-07', testRef: 'tests/payouts-refunds.integration.test.ts' },
  { id: 'ADM-05.A05', page: 'ADM-05', route: '/admin/finance', method: 'POST', endpoint: '/admin/webhooks/{id}/replay', permission: 'webhook.replay', status: 'unavailable', part: 'PART-13', reason: 'Replaying a stored event needs the inbox payload retained and re-fed through the signature check, which belongs with the wider operations tooling. An event that was never applied is already isolated and counted on this screen.' },

  { id: 'ADM-06.A01', page: 'ADM-06', route: '/admin/disbursements/{payoutId}', method: 'POST', endpoint: '/admin/payouts/{id}/execute', permission: 'payout.execute', status: 'implemented', part: 'PART-07', testRef: 'tests/payouts-refunds.integration.test.ts' },
  { id: 'ADM-06.A02', page: 'ADM-06', route: '/admin/disbursements/{payoutId}', method: 'POST', endpoint: '/refunds/{id}/approve', permission: 'refund.approve', status: 'implemented', part: 'PART-07', testRef: 'tests/payouts-refunds.integration.test.ts' },
  { id: 'ADM-06.A03', page: 'ADM-06', route: '/admin/disbursements/{payoutId}', method: 'POST', endpoint: '/admin/refunds/{id}/execute', permission: 'refund.execute', status: 'implemented', part: 'PART-07', testRef: 'tests/payouts-refunds.integration.test.ts' },
  { id: 'ADM-06.A04', page: 'ADM-06', route: '/admin/disbursements/{payoutId}', method: 'POST', endpoint: '/admin/payouts/{id}/inquire', permission: 'payment.inquire', status: 'implemented', part: 'PART-07', testRef: 'tests/payouts-refunds.integration.test.ts' },


  // ---- PART-08: ventures, offerings, eligibility and the data room -----------------------------
  { id: 'PUB-07.A01', page: 'PUB-07', route: '/invest', method: 'NAV', endpoint: '/invest/{slug}', permission: 'public', status: 'implemented', part: 'PART-08', testRef: 'tests/route-resolution.test.ts' },
  { id: 'PUB-07.A02', page: 'PUB-07', route: '/invest', method: 'LOCAL', endpoint: '/invest', permission: 'public', status: 'unavailable', part: 'PART-09', reason: 'Comparing offerings side by side needs more than one instrument to compare on; with common shares the only instrument in this release, a comparison would restate the same three fields the cards already show.' },
  { id: 'PUB-07.A03', page: 'PUB-07', route: '/invest', method: 'NAV', endpoint: '/app/investor/eligibility', permission: 'self', status: 'implemented', part: 'PART-08', testRef: 'tests/route-resolution.test.ts' },

  { id: 'PUB-08.A01', page: 'PUB-08', route: '/invest/{slug}', method: 'POST', endpoint: '/offerings/{slug}/interests', permission: 'self', status: 'implemented', part: 'PART-08', testRef: 'tests/investment.integration.test.ts' },
  { id: 'PUB-08.A02', page: 'PUB-08', route: '/invest/{slug}', method: 'POST', endpoint: '/offerings/{id}/access-requests', permission: 'self', status: 'implemented', part: 'PART-08', testRef: 'tests/investment.integration.test.ts' },
  { id: 'PUB-08.A03', page: 'PUB-08', route: '/invest/{slug}', method: 'NAV', endpoint: '/invest/{slug}/subscribe', permission: 'self', status: 'implemented', part: 'PART-09', testRef: 'tests/route-resolution.test.ts' },
  { id: 'PUB-08.A04', page: 'PUB-08', route: '/invest/{slug}', method: 'GET', endpoint: '/offerings/{slug}', permission: 'public', status: 'implemented', part: 'PART-08', testRef: 'tests/investment.integration.test.ts' },
  { id: 'PUB-08.A05', page: 'PUB-08', route: '/invest/{slug}', method: 'POST', endpoint: '/offerings/{id}/questions', permission: 'dataroom.read', status: 'implemented', part: 'PART-08', testRef: 'tests/investment.integration.test.ts' },

  { id: 'PER-07.A01', page: 'PER-07', route: '/app/investor/eligibility', method: 'PATCH', endpoint: '/me/investor-eligibility', permission: 'profile.manage', status: 'implemented', part: 'PART-08', testRef: 'tests/investment.integration.test.ts' },
  { id: 'PER-07.A02', page: 'PER-07', route: '/app/investor/eligibility', method: 'POST', endpoint: '/me/investor-eligibility/submissions', permission: 'self', status: 'implemented', part: 'PART-08', testRef: 'tests/investment.integration.test.ts' },
  { id: 'PER-07.A03', page: 'PER-07', route: '/app/investor/eligibility', method: 'POST', endpoint: '/me/investor-eligibility/submissions', permission: 'self', status: 'implemented', part: 'PART-08', testRef: 'tests/investment.integration.test.ts' },

  { id: 'BUS-01.A01', page: 'BUS-01', route: '/org/{id}/offerings', method: 'NAV', endpoint: '/org/{id}/offerings/new', permission: 'offering.manage', status: 'implemented', part: 'PART-08', testRef: 'tests/route-resolution.test.ts' },
  { id: 'BUS-01.A02', page: 'BUS-01', route: '/org/{id}/offerings', method: 'NAV', endpoint: '/org/{id}/offerings/{offeringId}', permission: 'offering.manage', status: 'implemented', part: 'PART-08', testRef: 'tests/route-resolution.test.ts' },
  { id: 'BUS-01.A03', page: 'BUS-01', route: '/org/{id}/offerings', method: 'POST', endpoint: '/orgs/{id}/offerings/{oid}/close', permission: 'offering.manage', status: 'implemented', part: 'PART-08', testRef: 'tests/investment.integration.test.ts' },

  { id: 'BUS-02.A01', page: 'BUS-02', route: '/org/{id}/offerings/{offeringId}', method: 'POST', endpoint: '/orgs/{id}/offerings', permission: 'offering.manage', status: 'implemented', part: 'PART-08', testRef: 'tests/investment.integration.test.ts' },
  { id: 'BUS-02.A02', page: 'BUS-02', route: '/org/{id}/offerings/{offeringId}', method: 'POST', endpoint: '/orgs/{id}/offerings/{oid}/validate', permission: 'offering.manage', status: 'implemented', part: 'PART-08', testRef: 'tests/share-maths.test.ts' },
  { id: 'BUS-02.A03', page: 'BUS-02', route: '/org/{id}/offerings/{offeringId}', method: 'POST', endpoint: '/orgs/{id}/offerings/{oid}/submit', permission: 'offering.manage', status: 'implemented', part: 'PART-08', testRef: 'tests/investment.integration.test.ts' },
  { id: 'BUS-02.A04', page: 'BUS-02', route: '/org/{id}/offerings/{offeringId}', method: 'POST', endpoint: '/orgs/{id}/offerings/{oid}/disclosure-revisions', permission: 'offering.manage', status: 'implemented', part: 'PART-08', testRef: 'tests/investment.integration.test.ts' },

  { id: 'BUS-03.A01', page: 'BUS-03', route: '/org/{id}/offerings/{offeringId}/dataroom', method: 'POST', endpoint: '/orgs/{id}/offerings/{oid}/documents', permission: 'offering.manage', status: 'implemented', part: 'PART-08', testRef: 'tests/investment.integration.test.ts' },
  { id: 'BUS-03.A02', page: 'BUS-03', route: '/org/{id}/offerings/{offeringId}/dataroom', method: 'POST', endpoint: '/orgs/{id}/offerings/{oid}/grants', permission: 'dataroom.manage', status: 'implemented', part: 'PART-08', testRef: 'tests/investment.integration.test.ts' },
  { id: 'BUS-03.A03', page: 'BUS-03', route: '/org/{id}/offerings/{offeringId}/dataroom', method: 'POST', endpoint: '/dataroom-grants/{id}/revoke', permission: 'dataroom.manage', status: 'implemented', part: 'PART-08', testRef: 'tests/investment.integration.test.ts' },
  { id: 'BUS-03.A04', page: 'BUS-03', route: '/org/{id}/offerings/{offeringId}/dataroom', method: 'POST', endpoint: '/investor-questions/{id}/replies', permission: 'offering.manage', status: 'implemented', part: 'PART-08', testRef: 'tests/investment.integration.test.ts' },

  { id: 'ADM-04.A01', page: 'ADM-04', route: '/admin/investment-reviews/{offeringId}', method: 'POST', endpoint: '/admin/offerings/{id}/decision', permission: 'offering.review', status: 'implemented', part: 'PART-08', testRef: 'tests/investment.integration.test.ts' },
  { id: 'ADM-04.A02', page: 'ADM-04', route: '/admin/investment-reviews/{offeringId}', method: 'POST', endpoint: '/admin/eligibility/{id}/decision', permission: 'eligibility.review', status: 'implemented', part: 'PART-08', testRef: 'tests/investment.integration.test.ts' },
  { id: 'ADM-04.A03', page: 'ADM-04', route: '/admin/investment-reviews', method: 'POST', endpoint: '/admin/allocation-requests/{id}/finalize', permission: 'allocation.finalize', status: 'implemented', part: 'PART-09', testRef: 'tests/subscription.integration.test.ts' },
  { id: 'ADM-04.A05', page: 'ADM-04', route: '/admin/investment-reviews', method: 'POST', endpoint: '/admin/allocation-requests/{id}/reject', permission: 'allocation.finalize', status: 'implemented', part: 'PART-09', testRef: 'tests/subscription.integration.test.ts' },
  { id: 'ADM-04.A04', page: 'ADM-04', route: '/admin/investment-reviews/{offeringId}', method: 'POST', endpoint: '/admin/offerings/{id}/decision', permission: 'offering.review', status: 'implemented', part: 'PART-08', testRef: 'tests/investment.integration.test.ts' },

  // ---- PART-09: PER-06/08/09, BUS-04/05 -------------------------------------------------------
  // Five of these are deliberately `unavailable`, and each is the same kind of thing: a generated,
  // stored document, or a support ticket. Neither store exists, and each screen writes the reason
  // where the control would have been rather than offering something that would fail.
  { id: 'PER-06.A01', page: 'PER-06', route: '/app/investments', method: 'NAV', endpoint: '/app/investments/{id}', permission: 'self', status: 'implemented', part: 'PART-09', testRef: 'tests/route-resolution.test.ts' },
  { id: 'PER-06.A02', page: 'PER-06', route: '/app/investments', method: 'POST', endpoint: '/me/investment-exports', permission: 'self', status: 'implemented', part: 'PART-13', testRef: 'tests/operations.integration.test.ts' },
  { id: 'PER-06.A03', page: 'PER-06', route: '/app/investments', method: 'NAV', endpoint: '/invest', permission: 'public', status: 'implemented', part: 'PART-09', testRef: 'tests/route-resolution.test.ts' },

  { id: 'PER-08.A01', page: 'PER-08', route: '/invest/{slug}/subscribe', method: 'POST', endpoint: '/offerings/{id}/commitments', permission: 'self', status: 'implemented', part: 'PART-09', testRef: 'tests/subscription.integration.test.ts' },
  { id: 'PER-08.A02', page: 'PER-08', route: '/invest/{slug}/subscribe', method: 'POST', endpoint: '/commitments/{id}/confirm', permission: 'self', status: 'implemented', part: 'PART-09', testRef: 'tests/subscription.integration.test.ts' },
  { id: 'PER-08.A03', page: 'PER-08', route: '/invest/{slug}/subscribe', method: 'POST', endpoint: '/commitments/{id}/payment-intents', permission: 'self', status: 'implemented', part: 'PART-09', testRef: 'tests/subscription.integration.test.ts' },
  { id: 'PER-08.A04', page: 'PER-08', route: '/invest/{slug}/subscribe', method: 'POST', endpoint: '/commitments/{id}/cancel', permission: 'self', status: 'implemented', part: 'PART-09', testRef: 'tests/subscription.integration.test.ts' },

  { id: 'PER-09.A01', page: 'PER-09', route: '/app/investments/{id}', method: 'GET', endpoint: '/allocations/{id}/proof', permission: 'self', status: 'implemented', part: 'PART-13', testRef: 'tests/subscription.integration.test.ts' },
  { id: 'PER-09.A02', page: 'PER-09', route: '/app/investments/{id}', method: 'POST', endpoint: '/offerings/{id}/nda-acceptances', permission: 'self', status: 'implemented', part: 'PART-09', testRef: 'tests/investment.integration.test.ts' },
  { id: 'PER-09.A03', page: 'PER-09', route: '/app/investments/{id}', method: 'GET', endpoint: '/dataroom-documents/{id}/download', permission: 'dataroom.read', status: 'implemented', part: 'PART-13', testRef: 'tests/verification-storage.test.ts' },
  { id: 'PER-09.A04', page: 'PER-09', route: '/app/investments/{id}', method: 'POST', endpoint: '/offerings/{id}/questions', permission: 'dataroom.read', status: 'implemented', part: 'PART-09', testRef: 'tests/investment.integration.test.ts' },
  { id: 'PER-09.A05', page: 'PER-09', route: '/app/investments/{id}', method: 'POST', endpoint: '/tickets', permission: 'self', status: 'implemented', part: 'PART-13', testRef: 'tests/operations.integration.test.ts' },

  { id: 'BUS-04.A01', page: 'BUS-04', route: '/org/{id}/offerings/{offeringId}/allocations', method: 'POST', endpoint: '/orgs/{id}/offerings/{oid}/allocations/preview', permission: 'offering.manage', status: 'implemented', part: 'PART-09', testRef: 'tests/subscription.integration.test.ts' },
  { id: 'BUS-04.A02', page: 'BUS-04', route: '/org/{id}/offerings/{offeringId}/allocations', method: 'POST', endpoint: '/orgs/{id}/offerings/{oid}/allocations/requests', permission: 'offering.manage', status: 'implemented', part: 'PART-09', testRef: 'tests/subscription.integration.test.ts' },
  { id: 'BUS-04.A03', page: 'BUS-04', route: '/org/{id}/offerings/{offeringId}/allocations', method: 'POST', endpoint: '/orgs/{id}/offerings/{oid}/allocation-exports', permission: 'investment.export', status: 'implemented', part: 'PART-13', testRef: 'tests/subscription.integration.test.ts' },
  { id: 'BUS-04.A04', page: 'BUS-04', route: '/org/{id}/offerings/{offeringId}/allocations', method: 'POST', endpoint: '/tickets', permission: 'finance.read', status: 'implemented', part: 'PART-13', testRef: 'tests/operations.integration.test.ts' },
  // INV-04. Not in 05-BUSINESS's action table, which was written before the failure path was
  // specified. Listed so that nothing rendered on the screen is undocumented.
  { id: 'BUS-04.A05', page: 'BUS-04', route: '/org/{id}/offerings/{offeringId}/allocations', method: 'POST', endpoint: '/orgs/{id}/offerings/{oid}/fail', permission: 'offering.manage', status: 'implemented', part: 'PART-09', testRef: 'tests/subscription.integration.test.ts' },
  { id: 'BUS-04.A06', page: 'BUS-04', route: '/org/{id}/offerings/{offeringId}/allocations', method: 'POST', endpoint: '/orgs/{id}/offerings/{oid}/close-after-refunds', permission: 'offering.manage', status: 'implemented', part: 'PART-09', testRef: 'tests/subscription.integration.test.ts' },

  { id: 'BUS-05.A01', page: 'BUS-05', route: '/org/{id}/investor-relations', method: 'POST', endpoint: '/orgs/{id}/company-reports', permission: 'report.publish', status: 'implemented', part: 'PART-09', testRef: 'tests/subscription.integration.test.ts' },
  { id: 'BUS-05.A02', page: 'BUS-05', route: '/org/{id}/investor-relations', method: 'POST', endpoint: '/orgs/{id}/distributions', permission: 'payout.request', status: 'implemented', part: 'PART-09', testRef: 'tests/subscription.integration.test.ts' },
  { id: 'BUS-05.A03', page: 'BUS-05', route: '/org/{id}/investor-relations', method: 'POST', endpoint: '/distributions/{id}/approve', permission: 'payout.approve', status: 'implemented', part: 'PART-09', testRef: 'tests/subscription.integration.test.ts' },
  { id: 'BUS-05.A04', page: 'BUS-05', route: '/org/{id}/investor-relations', method: 'POST', endpoint: '/orgs/{id}/corporate-events', permission: 'offering.manage', status: 'implemented', part: 'PART-09', testRef: 'tests/subscription.integration.test.ts' },

  // ---- PART-10: PUB-09/10, PER-10..13, PRG-01..05 ----------------------------------------------
  // The unavailable ones fall into three groups, and each says which: a job or a volunteering
  // listing (PART-11/PART-12), a stipend or a certificate (PART-12), and a generated document or a
  // support ticket (PART-13). Every one of them is written on its screen where the control would be.
  { id: 'PUB-09.A01', page: 'PUB-09', route: '/opportunities', method: 'NAV', endpoint: '/programs/{slug}', permission: 'public', status: 'implemented', part: 'PART-10', testRef: 'tests/route-resolution.test.ts' },
  { id: 'PUB-09.A02', page: 'PUB-09', route: '/opportunities', method: 'NAV', endpoint: '/jobs/{slug}', permission: 'public', status: 'implemented', part: 'PART-11', testRef: 'tests/employment.integration.test.ts' },
  { id: 'PUB-09.A03', page: 'PUB-09', route: '/opportunities', method: 'NAV', endpoint: '/volunteer', permission: 'public', status: 'implemented', part: 'PART-12', testRef: 'tests/enablement.integration.test.ts' },
  { id: 'PUB-09.A04', page: 'PUB-09', route: '/opportunities', method: 'POST', endpoint: '/bookmarks', permission: 'self', status: 'implemented', part: 'PART-10', testRef: 'tests/programs.integration.test.ts' },
  { id: 'PUB-10.A01', page: 'PUB-10', route: '/programs/{slug}', method: 'NAV', endpoint: '/app/applications/new', permission: 'self', status: 'implemented', part: 'PART-10', testRef: 'tests/route-resolution.test.ts' },
  { id: 'PUB-10.A02', page: 'PUB-10', route: '/programs/{slug}', method: 'POST', endpoint: '/tickets', permission: 'self', status: 'implemented', part: 'PART-13', testRef: 'tests/operations.integration.test.ts' },
  { id: 'PUB-10.A03', page: 'PUB-10', route: '/programs/{slug}', method: 'GET', endpoint: '/programs/{slug}/curriculum', permission: 'public', status: 'implemented', part: 'PART-10', testRef: 'tests/programs.integration.test.ts' },
  { id: 'PUB-10.A04', page: 'PUB-10', route: '/programs/{slug}', method: 'POST', endpoint: '/bookmarks', permission: 'self', status: 'implemented', part: 'PART-10', testRef: 'tests/programs.integration.test.ts' },

  { id: 'PER-10.A01', page: 'PER-10', route: '/app/career/profile', method: 'PATCH', endpoint: '/me/candidate-profile', permission: 'profile.manage', status: 'implemented', part: 'PART-10', testRef: 'tests/programs.integration.test.ts' },
  { id: 'PER-10.A02', page: 'PER-10', route: '/app/career/profile', method: 'POST', endpoint: '/documents/upload-intents', permission: 'profile.manage', status: 'unavailable', part: 'PART-13', reason: 'Uploading a CV needs the document store, its scan and its classification checks, which exist only for verification documents so far. The field takes a reference the candidate writes instead, and says so.' },
  { id: 'PER-10.A03', page: 'PER-10', route: '/app/career/profile', method: 'GET', endpoint: '/me/candidate-profile/employer-preview', permission: 'self', status: 'implemented', part: 'PART-10', testRef: 'tests/programs.integration.test.ts' },
  { id: 'PER-10.A04', page: 'PER-10', route: '/app/career/profile', method: 'NAV', endpoint: '/opportunities', permission: 'public', status: 'implemented', part: 'PART-10', testRef: 'tests/route-resolution.test.ts' },

  { id: 'PER-11.A01', page: 'PER-11', route: '/app/applications/new', method: 'POST', endpoint: '/applications', permission: 'self', status: 'implemented', part: 'PART-10', testRef: 'tests/programs.integration.test.ts' },
  { id: 'PER-11.A02', page: 'PER-11', route: '/app/applications/{id}', method: 'POST', endpoint: '/applications/{id}/submit', permission: 'self', status: 'implemented', part: 'PART-10', testRef: 'tests/programs.integration.test.ts' },
  { id: 'PER-11.A03', page: 'PER-11', route: '/app/applications/{id}', method: 'LOCAL', endpoint: '/app/applications/{id}', permission: 'self', status: 'implemented', part: 'PART-10', testRef: 'tests/route-resolution.test.ts' },
  { id: 'PER-11.A04', page: 'PER-11', route: '/app/applications/{id}', method: 'POST', endpoint: '/applications/{id}/discard', permission: 'self', status: 'implemented', part: 'PART-10', testRef: 'tests/programs.integration.test.ts' },

  { id: 'PER-12.A01', page: 'PER-12', route: '/app/applications', method: 'NAV', endpoint: '/app/applications/{id}', permission: 'self', status: 'implemented', part: 'PART-10', testRef: 'tests/route-resolution.test.ts' },
  { id: 'PER-12.A02', page: 'PER-12', route: '/app/applications/{id}', method: 'POST', endpoint: '/applications/{id}/withdraw', permission: 'self', status: 'implemented', part: 'PART-10', testRef: 'tests/programs.integration.test.ts' },
  { id: 'PER-12.A03', page: 'PER-12', route: '/app/applications/{id}', method: 'POST', endpoint: '/interviews/{id}/confirm', permission: 'self', status: 'implemented', part: 'PART-10', testRef: 'tests/programs.integration.test.ts' },
  { id: 'PER-12.A04', page: 'PER-12', route: '/app/applications/{id}', method: 'POST', endpoint: '/interviews/{id}/reschedule-requests', permission: 'self', status: 'implemented', part: 'PART-10', testRef: 'tests/programs.integration.test.ts' },
  { id: 'PER-12.A05', page: 'PER-12', route: '/app/applications/{id}', method: 'POST', endpoint: '/enrollments/{id}/accept', permission: 'self', status: 'implemented', part: 'PART-10', testRef: 'tests/programs.integration.test.ts' },

  { id: 'PER-13.A01', page: 'PER-13', route: '/app/training/{id}', method: 'NAV', endpoint: '/app/training/{id}', permission: 'self', status: 'unavailable', part: 'PART-13', reason: 'A session page for a trainee would hold its materials and handouts, which need the document store. Everything a trainee can currently know about a session — its time, its zone, its place and their own attendance — is already on the row, so a separate page would be a click to the same words.' },
  { id: 'PER-13.A02', page: 'PER-13', route: '/app/training/{id}', method: 'POST', endpoint: '/attendance/{id}/objections', permission: 'self', status: 'implemented', part: 'PART-10', testRef: 'tests/programs.integration.test.ts' },
  // PART-12 built the certificate. There is still no file to download — the document store is
  // PART-13 — so the action is the public reference and the check it resolves to, which is what a
  // certificate is actually for: something a third party can verify.
  { id: 'PER-13.A03', page: 'PER-13', route: '/app/training/{id}', method: 'GET', endpoint: '/certificates/{publicId}/verify', permission: 'public', status: 'implemented', part: 'PART-12', testRef: 'tests/enablement.integration.test.ts' },
  // PART-12 built the entitlement. The figure now exists, with the arithmetic beside it, and it
  // still says plainly that only a paid payout means money arrived.
  { id: 'PER-13.A04', page: 'PER-13', route: '/app/training/{id}', method: 'GET', endpoint: '/me/stipends', permission: 'self', status: 'implemented', part: 'PART-12', testRef: 'tests/enablement.integration.test.ts' },
  { id: 'PER-13.A05', page: 'PER-13', route: '/app/training/{id}', method: 'POST', endpoint: '/enrollments/{id}/withdrawal-requests', permission: 'self', status: 'implemented', part: 'PART-10', testRef: 'tests/programs.integration.test.ts' },

  { id: 'PRG-01.A01', page: 'PRG-01', route: '/org/{id}/programs', method: 'NAV', endpoint: '/org/{id}/programs/new', permission: 'program.manage', status: 'implemented', part: 'PART-10', testRef: 'tests/route-resolution.test.ts' },
  { id: 'PRG-01.A02', page: 'PRG-01', route: '/org/{id}/programs', method: 'NAV', endpoint: '/org/{id}/programs/{programId}', permission: 'program.read', status: 'implemented', part: 'PART-10', testRef: 'tests/route-resolution.test.ts' },
  { id: 'PRG-01.A03', page: 'PRG-01', route: '/org/{id}/programs', method: 'NAV', endpoint: '/org/{id}/applications', permission: 'application.review', status: 'implemented', part: 'PART-10', testRef: 'tests/route-resolution.test.ts' },

  { id: 'PRG-02.A01', page: 'PRG-02', route: '/org/{id}/programs/new', method: 'POST', endpoint: '/orgs/{id}/programs', permission: 'program.manage', status: 'implemented', part: 'PART-10', testRef: 'tests/programs.integration.test.ts' },
  { id: 'PRG-02.A02', page: 'PRG-02', route: '/org/{id}/programs/{programId}', method: 'POST', endpoint: '/orgs/{id}/programs/{pid}/cohorts', permission: 'program.manage', status: 'implemented', part: 'PART-10', testRef: 'tests/programs.integration.test.ts' },
  { id: 'PRG-02.A03', page: 'PRG-02', route: '/org/{id}/programs/{programId}', method: 'POST', endpoint: '/orgs/{id}/programs/{pid}/submit', permission: 'program.manage', status: 'implemented', part: 'PART-10', testRef: 'tests/programs.integration.test.ts' },
  { id: 'PRG-02.A04', page: 'PRG-02', route: '/org/{id}/programs/{programId}', method: 'POST', endpoint: '/orgs/{id}/programs/{pid}/publish', permission: 'program.publish', status: 'implemented', part: 'PART-10', testRef: 'tests/programs.integration.test.ts' },

  { id: 'PRG-03.A01', page: 'PRG-03', route: '/org/{id}/applications', method: 'GET', endpoint: '/orgs/{id}/applications/{aid}', permission: 'application.review', status: 'implemented', part: 'PART-10', testRef: 'tests/programs.integration.test.ts' },
  { id: 'PRG-03.A02', page: 'PRG-03', route: '/org/{id}/applications/{applicationId}', method: 'POST', endpoint: '/orgs/{id}/applications/{aid}/reviews', permission: 'application.review', status: 'implemented', part: 'PART-10', testRef: 'tests/programs.integration.test.ts' },
  { id: 'PRG-03.A03', page: 'PRG-03', route: '/org/{id}/applications/{applicationId}', method: 'POST', endpoint: '/orgs/{id}/applications/{aid}/interviews', permission: 'application.review', status: 'implemented', part: 'PART-10', testRef: 'tests/programs.integration.test.ts' },
  { id: 'PRG-03.A04', page: 'PRG-03', route: '/org/{id}/applications/{applicationId}', method: 'POST', endpoint: '/orgs/{id}/applications/{aid}/decision', permission: 'application.review', status: 'implemented', part: 'PART-10', testRef: 'tests/programs.integration.test.ts' },
  { id: 'PRG-03.A05', page: 'PRG-03', route: '/org/{id}/applications/{applicationId}', method: 'POST', endpoint: '/orgs/{id}/application-exports', permission: 'candidate.export', status: 'implemented', part: 'PART-13', testRef: 'tests/programs.integration.test.ts' },

  { id: 'PRG-04.A01', page: 'PRG-04', route: '/org/{id}/cohorts/{cohortId}', method: 'POST', endpoint: '/cohorts/{id}/trainers', permission: 'program.manage', status: 'implemented', part: 'PART-10', testRef: 'tests/programs.integration.test.ts' },
  { id: 'PRG-04.A02', page: 'PRG-04', route: '/org/{id}/cohorts/{cohortId}', method: 'POST', endpoint: '/cohorts/{id}/sessions', permission: 'program.manage', status: 'implemented', part: 'PART-10', testRef: 'tests/programs.integration.test.ts' },
  { id: 'PRG-04.A03', page: 'PRG-04', route: '/org/{id}/cohorts/{cohortId}', method: 'POST', endpoint: '/cohorts/{id}/waitlist/invite-next', permission: 'application.review', status: 'implemented', part: 'PART-10', testRef: 'tests/programs.integration.test.ts' },
  { id: 'PRG-04.A04', page: 'PRG-04', route: '/org/{id}/cohorts/{cohortId}', method: 'POST', endpoint: '/enrollments/{id}/withdraw', permission: 'program.manage', status: 'implemented', part: 'PART-10', testRef: 'tests/programs.integration.test.ts' },

  { id: 'PRG-05.A01', page: 'PRG-05', route: '/org/{id}/cohorts/{cohortId}/sessions/{sessionId}', method: 'PUT', endpoint: '/sessions/{id}/attendance', permission: 'attendance.record', status: 'implemented', part: 'PART-10', testRef: 'tests/programs.integration.test.ts' },
  { id: 'PRG-05.A02', page: 'PRG-05', route: '/org/{id}/cohorts/{cohortId}/sessions/{sessionId}', method: 'PUT', endpoint: '/sessions/{id}/attendance', permission: 'attendance.correct', status: 'implemented', part: 'PART-10', testRef: 'tests/programs.integration.test.ts' },
  { id: 'PRG-05.A03', page: 'PRG-05', route: '/org/{id}/cohorts/{cohortId}/sessions/{sessionId}', method: 'POST', endpoint: '/assessments/{id}/results', permission: 'assessment.record', status: 'implemented', part: 'PART-10', testRef: 'tests/programs.integration.test.ts' },
  { id: 'PRG-05.A04', page: 'PRG-05', route: '/org/{id}/cohorts/{cohortId}/sessions/{sessionId}', method: 'POST', endpoint: '/attendance-objections/{id}/decision', permission: 'attendance.review', status: 'implemented', part: 'PART-10', testRef: 'tests/programs.integration.test.ts' },

  // ADM-03 is one screen for project, programme and report reviews. A01..A04 cover the project
  // (PART-05); these three are the same three decisions taken on a programme.
  { id: 'ADM-03.A05', page: 'ADM-03', route: '/admin/program-reviews', method: 'POST', endpoint: '/admin/programs/{id}/decision', permission: 'content.review', status: 'implemented', part: 'PART-10', testRef: 'tests/programs.integration.test.ts' },
  { id: 'ADM-03.A06', page: 'ADM-03', route: '/admin/program-reviews', method: 'POST', endpoint: '/admin/programs/{id}/claim', permission: 'content.review', status: 'implemented', part: 'PART-10', testRef: 'tests/programs.integration.test.ts' },
  { id: 'ADM-03.A07', page: 'ADM-03', route: '/admin/program-reviews', method: 'GET', endpoint: '/admin/program-reviews/{id}', permission: 'content.review', status: 'implemented', part: 'PART-10', testRef: 'tests/programs.integration.test.ts' },

  // ---- PART-11: jobs, offers, placements and follow-up ----------------------------------------
  // The two rules worth naming here, because a manifest is where a missing control shows up first:
  // PUB-11.A03 and the shared ticket surface are PART-13, so the pages state the absence; and
  // PER-14.A05 is implemented as the placement's own objection, which does the real thing 07 asks
  // for (the placement stops counting) rather than posting to a queue nobody reads.
  { id: 'PUB-11.A01', page: 'PUB-11', route: '/jobs/{slug}', method: 'NAV', endpoint: '/app/applications/new', permission: 'self', status: 'implemented', part: 'PART-11', testRef: 'tests/route-resolution.test.ts' },
  { id: 'PUB-11.A02', page: 'PUB-11', route: '/jobs/{slug}', method: 'LOCAL', endpoint: '/jobs/{slug}', permission: 'public', status: 'implemented', part: 'PART-11', testRef: 'tests/employment.integration.test.ts' },
  { id: 'PUB-11.A03', page: 'PUB-11', route: '/jobs/{slug}', method: 'POST', endpoint: '/tickets', permission: 'self', status: 'implemented', part: 'PART-13', testRef: 'tests/operations.integration.test.ts' },

  { id: 'PER-14.A01', page: 'PER-14', route: '/app/job-offers/{id}', method: 'POST', endpoint: '/job-offers/{id}/accept', permission: 'self', status: 'implemented', part: 'PART-11', testRef: 'tests/employment.integration.test.ts' },
  { id: 'PER-14.A02', page: 'PER-14', route: '/app/job-offers/{id}', method: 'POST', endpoint: '/job-offers/{id}/decline', permission: 'self', status: 'implemented', part: 'PART-11', testRef: 'tests/employment.integration.test.ts' },
  { id: 'PER-14.A03', page: 'PER-14', route: '/app/placements/{id}', method: 'POST', endpoint: '/placements/{id}/start-confirmations', permission: 'self', status: 'implemented', part: 'PART-11', testRef: 'tests/employment.integration.test.ts' },
  { id: 'PER-14.A04', page: 'PER-14', route: '/app/placements/{id}', method: 'POST', endpoint: '/placements/{id}/followups', permission: 'self', status: 'implemented', part: 'PART-11', testRef: 'tests/employment.integration.test.ts' },
  { id: 'PER-14.A05', page: 'PER-14', route: '/app/placements/{id}', method: 'POST', endpoint: '/placements/{id}/disputes', permission: 'self', status: 'implemented', part: 'PART-11', testRef: 'tests/employment.integration.test.ts' },

  { id: 'PRG-07.A01', page: 'PRG-07', route: '/org/{orgId}/jobs', method: 'POST', endpoint: '/orgs/{id}/jobs', permission: 'job.manage', status: 'implemented', part: 'PART-11', testRef: 'tests/employment.integration.test.ts' },
  { id: 'PRG-07.A02', page: 'PRG-07', route: '/org/{orgId}/jobs/{jid}/edit', method: 'PATCH', endpoint: '/orgs/{id}/jobs/{jid}', permission: 'job.manage', status: 'implemented', part: 'PART-11', testRef: 'tests/employment.integration.test.ts' },
  { id: 'PRG-07.A03', page: 'PRG-07', route: '/org/{orgId}/jobs/{jid}/edit', method: 'POST', endpoint: '/orgs/{id}/jobs/{jid}/publish', permission: 'job.publish', status: 'implemented', part: 'PART-11', testRef: 'tests/employment.integration.test.ts' },
  { id: 'PRG-07.A04', page: 'PRG-07', route: '/org/{orgId}/jobs/{jid}/edit', method: 'POST', endpoint: '/orgs/{id}/jobs/{jid}/close', permission: 'job.manage', status: 'implemented', part: 'PART-11', testRef: 'tests/employment.integration.test.ts' },
  { id: 'PRG-07.A05', page: 'PRG-07', route: '/org/{orgId}/jobs/{jid}/edit', method: 'POST', endpoint: '/orgs/{id}/jobs/{jid}/referrals', permission: 'application.review', status: 'implemented', part: 'PART-11', testRef: 'tests/employment.integration.test.ts' },

  { id: 'PRG-08.A01', page: 'PRG-08', route: '/org/{orgId}/job-offers', method: 'POST', endpoint: '/orgs/{id}/job-offers', permission: 'job.manage', status: 'implemented', part: 'PART-11', testRef: 'tests/employment.integration.test.ts' },
  { id: 'PRG-08.A02', page: 'PRG-08', route: '/org/{orgId}/job-offers', method: 'POST', endpoint: '/job-offers/{id}/send', permission: 'job.manage', status: 'implemented', part: 'PART-11', testRef: 'tests/employment.integration.test.ts' },
  { id: 'PRG-08.A03', page: 'PRG-08', route: '/org/{orgId}/job-offers', method: 'POST', endpoint: '/job-offers/{id}/withdraw', permission: 'job.manage', status: 'implemented', part: 'PART-11', testRef: 'tests/employment.integration.test.ts' },
  { id: 'PRG-08.A04', page: 'PRG-08', route: '/org/{orgId}/placements', method: 'POST', endpoint: '/placements/{id}/start-confirmations', permission: 'placement.verify', status: 'implemented', part: 'PART-11', testRef: 'tests/employment.integration.test.ts' },

  { id: 'PRG-09.A01', page: 'PRG-09', route: '/org/{orgId}/placements', method: 'POST', endpoint: '/placements/{id}/followup-requests', permission: 'placement.verify', status: 'implemented', part: 'PART-11', testRef: 'tests/employment.integration.test.ts' },
  { id: 'PRG-09.A02', page: 'PRG-09', route: '/org/{orgId}/placements', method: 'POST', endpoint: '/placements/{id}/followups', permission: 'placement.verify', status: 'implemented', part: 'PART-11', testRef: 'tests/employment.integration.test.ts' },
  { id: 'PRG-09.A03', page: 'PRG-09', route: '/org/{orgId}/placements', method: 'POST', endpoint: '/placements/{id}/review-decisions', permission: 'placement.review', status: 'implemented', part: 'PART-11', testRef: 'tests/employment.integration.test.ts' },
  { id: 'PRG-09.A04', page: 'PRG-09', route: '/org/{orgId}/placements', method: 'POST', endpoint: '/orgs/{id}/placement-exports', permission: 'report.read', status: 'implemented', part: 'PART-11', testRef: 'tests/employment.integration.test.ts' },

  // ---- PART-12: agreements, outcomes, incubation, assistance and volunteering ------------------
  // Three of this part's actions are `unavailable`, all for the same reason: they post to the
  // shared ticket queue, which is PART-13. Each screen states that in substance and points at the
  // thing that does work — for a placement or an assistance delivery, the objection that actually
  // takes the record out of every count.
  { id: 'BUS-06.A01', page: 'BUS-06', route: '/org/{orgId}/agreements', method: 'POST', endpoint: '/orgs/{id}/agreements', permission: 'agreement.manage', status: 'implemented', part: 'PART-12', testRef: 'tests/enablement.integration.test.ts' },
  { id: 'BUS-06.A02', page: 'BUS-06', route: '/org/{orgId}/agreements/{aid}', method: 'POST', endpoint: '/agreements/{id}/submit', permission: 'agreement.manage', status: 'implemented', part: 'PART-12', testRef: 'tests/enablement.integration.test.ts' },
  { id: 'BUS-06.A03', page: 'BUS-06', route: '/org/{orgId}/agreements/{aid}', method: 'POST', endpoint: '/agreements/{id}/accept', permission: 'agreement.accept', status: 'implemented', part: 'PART-12', testRef: 'tests/enablement.integration.test.ts' },
  { id: 'BUS-06.A04', page: 'BUS-06', route: '/org/{orgId}/agreements/{aid}', method: 'POST', endpoint: '/orgs/{id}/agreement-milestones/{mid}/decision', permission: 'agreement.review', status: 'implemented', part: 'PART-12', testRef: 'tests/enablement.integration.test.ts' },
  { id: 'BUS-06.A05', page: 'BUS-06', route: '/org/{orgId}/agreements/{aid}', method: 'POST', endpoint: '/tickets', permission: 'agreement.manage', status: 'implemented', part: 'PART-13', testRef: 'tests/operations.integration.test.ts' },

  { id: 'PRG-06.A01', page: 'PRG-06', route: '/org/{orgId}/programs/{pid}/outcomes', method: 'POST', endpoint: '/orgs/{id}/cohorts/{cid}/stipend-batches', permission: 'stipend.request', status: 'implemented', part: 'PART-12', testRef: 'tests/enablement.integration.test.ts' },
  { id: 'PRG-06.A02', page: 'PRG-06', route: '/org/{orgId}/programs/{pid}/outcomes', method: 'POST', endpoint: '/orgs/{id}/stipend-batches/{bid}/payout-request', permission: 'payout.request', status: 'implemented', part: 'PART-12', testRef: 'tests/enablement.integration.test.ts' },
  { id: 'PRG-06.A03', page: 'PRG-06', route: '/org/{orgId}/programs/{pid}/outcomes', method: 'POST', endpoint: '/orgs/{id}/enrollments/{eid}/certificate', permission: 'certificate.issue', status: 'implemented', part: 'PART-12', testRef: 'tests/enablement.integration.test.ts' },
  { id: 'PRG-06.A04', page: 'PRG-06', route: '/org/{orgId}/programs/{pid}/outcomes', method: 'POST', endpoint: '/orgs/{id}/certificates/{cid}/revoke', permission: 'certificate.revoke', status: 'implemented', part: 'PART-12', testRef: 'tests/enablement.integration.test.ts' },

  { id: 'PRG-10.A01', page: 'PRG-10', route: '/org/{orgId}/proposals/{pid}', method: 'POST', endpoint: '/orgs/{id}/proposals/{pid}/decision', permission: 'proposal.review', status: 'implemented', part: 'PART-12', testRef: 'tests/enablement.integration.test.ts' },
  { id: 'PRG-10.A02', page: 'PRG-10', route: '/org/{orgId}/proposals/{pid}', method: 'POST', endpoint: '/orgs/{id}/proposals/{pid}/mentor-assignments', permission: 'program.manage', status: 'implemented', part: 'PART-12', testRef: 'tests/enablement.integration.test.ts' },
  { id: 'PRG-10.A03', page: 'PRG-10', route: '/org/{orgId}/proposals/{pid}', method: 'POST', endpoint: '/orgs/{id}/proposals/{pid}/incubation-agreements', permission: 'agreement.manage', status: 'implemented', part: 'PART-12', testRef: 'tests/enablement.integration.test.ts' },
  { id: 'PRG-10.A04', page: 'PRG-10', route: '/org/{orgId}/proposals/{pid}', method: 'POST', endpoint: '/orgs/{id}/incubation-milestones/{mid}/decision', permission: 'proposal.review', status: 'implemented', part: 'PART-12', testRef: 'tests/enablement.integration.test.ts' },
  { id: 'PRG-10.A05', page: 'PRG-10', route: '/org/{orgId}/proposals/{pid}', method: 'POST', endpoint: '/orgs/{id}/proposals/{pid}/close', permission: 'program.manage', status: 'implemented', part: 'PART-12', testRef: 'tests/enablement.integration.test.ts' },

  { id: 'PRG-11.A01', page: 'PRG-11', route: '/org/{orgId}/sponsorships', method: 'POST', endpoint: '/agreements/{id}/funding-intents', permission: 'sponsorship.fund', status: 'implemented', part: 'PART-12', testRef: 'tests/enablement.integration.test.ts' },
  { id: 'PRG-11.A02', page: 'PRG-11', route: '/org/{orgId}/agreements/{aid}', method: 'POST', endpoint: '/orgs/{id}/agreement-reports/{rid}/decision', permission: 'agreement.review', status: 'implemented', part: 'PART-12', testRef: 'tests/enablement.integration.test.ts' },
  { id: 'PRG-11.A03', page: 'PRG-11', route: '/org/{orgId}/sponsorships', method: 'POST', endpoint: '/tickets', permission: 'agreement.manage', status: 'implemented', part: 'PART-13', testRef: 'tests/operations.integration.test.ts' },
  { id: 'PRG-11.A04', page: 'PRG-11', route: '/org/{orgId}/sponsorships', method: 'POST', endpoint: '/orgs/{id}/sponsor-exports', permission: 'report.read', status: 'implemented', part: 'PART-12', testRef: 'tests/enablement.integration.test.ts' },

  { id: 'PRG-12.A01', page: 'PRG-12', route: '/org/{orgId}/assistance/{caseId}', method: 'POST', endpoint: '/orgs/{id}/assistance/{caseId}/clarifications', permission: 'assistance.manage', status: 'implemented', part: 'PART-12', testRef: 'tests/enablement.integration.test.ts' },
  { id: 'PRG-12.A02', page: 'PRG-12', route: '/org/{orgId}/assistance/{caseId}', method: 'POST', endpoint: '/orgs/{id}/assistance/{caseId}/decisions', permission: 'assistance.manage', status: 'implemented', part: 'PART-12', testRef: 'tests/enablement.integration.test.ts' },
  { id: 'PRG-12.A03', page: 'PRG-12', route: '/org/{orgId}/assistance/{caseId}', method: 'POST', endpoint: '/orgs/{id}/assistance/{caseId}/deliveries', permission: 'assistance.manage', status: 'implemented', part: 'PART-12', testRef: 'tests/enablement.integration.test.ts' },
  { id: 'PRG-12.A04', page: 'PRG-12', route: '/org/{orgId}/assistance/{caseId}', method: 'POST', endpoint: '/orgs/{id}/assistance/{caseId}/close', permission: 'assistance.manage', status: 'implemented', part: 'PART-12', testRef: 'tests/enablement.integration.test.ts' },

  { id: 'PRG-13.A01', page: 'PRG-13', route: '/org/{orgId}/volunteering', method: 'POST', endpoint: '/orgs/{id}/volunteer-opportunities', permission: 'volunteer.manage', status: 'implemented', part: 'PART-12', testRef: 'tests/enablement.integration.test.ts' },
  { id: 'PRG-13.A02', page: 'PRG-13', route: '/org/{orgId}/volunteering', method: 'POST', endpoint: '/orgs/{id}/volunteer-applications/{aid}/decision', permission: 'volunteer.manage', status: 'implemented', part: 'PART-12', testRef: 'tests/enablement.integration.test.ts' },
  { id: 'PRG-13.A03', page: 'PRG-13', route: '/org/{orgId}/volunteering', method: 'POST', endpoint: '/orgs/{id}/volunteer-assignments', permission: 'volunteer.manage', status: 'implemented', part: 'PART-12', testRef: 'tests/enablement.integration.test.ts' },
  { id: 'PRG-13.A04', page: 'PRG-13', route: '/org/{orgId}/volunteering', method: 'POST', endpoint: '/orgs/{id}/volunteer-hours/{hid}/decision', permission: 'volunteer.manage', status: 'implemented', part: 'PART-12', testRef: 'tests/enablement.integration.test.ts' },

  { id: 'PER-15.A01', page: 'PER-15', route: '/app/assistance', method: 'POST', endpoint: '/assistance', permission: 'self', status: 'implemented', part: 'PART-12', testRef: 'tests/enablement.integration.test.ts' },
  { id: 'PER-15.A02', page: 'PER-15', route: '/app/assistance/{id}', method: 'POST', endpoint: '/assistance/{id}/replies', permission: 'self', status: 'implemented', part: 'PART-12', testRef: 'tests/enablement.integration.test.ts' },
  { id: 'PER-15.A03', page: 'PER-15', route: '/app/assistance/{id}', method: 'POST', endpoint: '/assistance/{id}/deliveries/{did}/confirm', permission: 'self', status: 'implemented', part: 'PART-12', testRef: 'tests/enablement.integration.test.ts' },
  { id: 'PER-15.A04', page: 'PER-15', route: '/app/assistance/{id}', method: 'POST', endpoint: '/tickets', permission: 'self', status: 'implemented', part: 'PART-13', testRef: 'tests/operations.integration.test.ts' },
  { id: 'PER-15.A05', page: 'PER-15', route: '/app/assistance/{id}', method: 'POST', endpoint: '/assistance/{id}/consent-revocations', permission: 'self', status: 'implemented', part: 'PART-12', testRef: 'tests/enablement.integration.test.ts' },

  { id: 'PER-16.A01', page: 'PER-16', route: '/app/proposals', method: 'POST', endpoint: '/proposals', permission: 'self', status: 'implemented', part: 'PART-12', testRef: 'tests/enablement.integration.test.ts' },
  { id: 'PER-16.A02', page: 'PER-16', route: '/app/proposals/{id}', method: 'POST', endpoint: '/proposals/{id}/submit', permission: 'self', status: 'implemented', part: 'PART-12', testRef: 'tests/enablement.integration.test.ts' },
  { id: 'PER-16.A03', page: 'PER-16', route: '/app/proposals/{id}', method: 'POST', endpoint: '/incubation-agreements/{id}/accept', permission: 'self', status: 'implemented', part: 'PART-12', testRef: 'tests/enablement.integration.test.ts' },
  { id: 'PER-16.A04', page: 'PER-16', route: '/app/proposals/{id}', method: 'POST', endpoint: '/incubation-milestones/{id}/evidence', permission: 'self', status: 'implemented', part: 'PART-12', testRef: 'tests/enablement.integration.test.ts' },
  { id: 'PER-16.A05', page: 'PER-16', route: '/app/proposals/{id}', method: 'NAV', endpoint: '/app/organizations/new', permission: 'organization.manage', status: 'implemented', part: 'PART-12', testRef: 'tests/route-resolution.test.ts' },

  { id: 'PER-17.A01', page: 'PER-17', route: '/app/volunteering', method: 'POST', endpoint: '/volunteer-applications', permission: 'self', status: 'implemented', part: 'PART-12', testRef: 'tests/enablement.integration.test.ts' },
  { id: 'PER-17.A02', page: 'PER-17', route: '/app/volunteering', method: 'POST', endpoint: '/volunteer-assignments/{id}/accept', permission: 'self', status: 'implemented', part: 'PART-12', testRef: 'tests/enablement.integration.test.ts' },
  { id: 'PER-17.A03', page: 'PER-17', route: '/app/volunteering', method: 'POST', endpoint: '/volunteer-hours', permission: 'self', status: 'implemented', part: 'PART-12', testRef: 'tests/enablement.integration.test.ts' },
  { id: 'PER-17.A04', page: 'PER-17', route: '/app/volunteering', method: 'POST', endpoint: '/volunteer-applications/{id}/withdraw', permission: 'self', status: 'implemented', part: 'PART-12', testRef: 'tests/enablement.integration.test.ts' },

  // ---- PART-13: notifications, support and platform operations ---------------------------------
  { id: 'PER-19.A01', page: 'PER-19', route: '/app/notifications', method: 'POST', endpoint: '/notifications/{id}/read', permission: 'self', status: 'implemented', part: 'PART-13', testRef: 'tests/operations.integration.test.ts' },
  { id: 'PER-19.A02', page: 'PER-19', route: '/app/notifications', method: 'POST', endpoint: '/me/notifications/read-all', permission: 'self', status: 'implemented', part: 'PART-13', testRef: 'tests/operations.integration.test.ts' },
  { id: 'PER-19.A03', page: 'PER-19', route: '/app/saved', method: 'DELETE', endpoint: '/bookmarks/{id}', permission: 'self', status: 'implemented', part: 'PART-04', testRef: 'tests/projects.integration.test.ts' },
  { id: 'PER-19.A04', page: 'PER-19', route: '/app/saved', method: 'DELETE', endpoint: '/follows/{id}', permission: 'self', status: 'implemented', part: 'PART-13', testRef: 'tests/operations.integration.test.ts' },

  { id: 'PER-20.A01', page: 'PER-20', route: '/contact', method: 'POST', endpoint: '/tickets', permission: 'self', status: 'implemented', part: 'PART-13', testRef: 'tests/operations.integration.test.ts' },
  { id: 'PER-20.A02', page: 'PER-20', route: '/app/tickets/{id}', method: 'POST', endpoint: '/tickets/{id}/replies', permission: 'self', status: 'implemented', part: 'PART-13', testRef: 'tests/operations.integration.test.ts' },
  { id: 'PER-20.A03', page: 'PER-20', route: '/app/tickets/{id}', method: 'POST', endpoint: '/tickets/{id}/reopen', permission: 'self', status: 'implemented', part: 'PART-13', testRef: 'tests/operations.integration.test.ts' },
  { id: 'PER-20.A04', page: 'PER-20', route: '/app/tickets/{id}', method: 'POST', endpoint: '/tickets/{id}/confirm-resolution', permission: 'self', status: 'implemented', part: 'PART-13', testRef: 'tests/operations.integration.test.ts' },

  { id: 'ADM-07.A01', page: 'ADM-07', route: '/admin/tickets/{id}', method: 'POST', endpoint: '/tickets/{id}/replies', permission: 'support.manage', status: 'implemented', part: 'PART-13', testRef: 'tests/operations.integration.test.ts' },
  { id: 'ADM-07.A02', page: 'ADM-07', route: '/admin/tickets/{id}', method: 'POST', endpoint: '/admin/tickets/{id}/escalate', permission: 'support.manage', status: 'implemented', part: 'PART-13', testRef: 'tests/operations.integration.test.ts' },
  { id: 'ADM-07.A03', page: 'ADM-07', route: '/admin/tickets/{id}', method: 'POST', endpoint: '/admin/subjects/{id}/freeze', permission: 'risk.freeze', status: 'implemented', part: 'PART-13', testRef: 'tests/operations.integration.test.ts' },
  { id: 'ADM-07.A04', page: 'ADM-07', route: '/admin/tickets/{id}', method: 'POST', endpoint: '/admin/subjects/{id}/unfreeze', permission: 'risk.unfreeze', status: 'implemented', part: 'PART-13', testRef: 'tests/operations.integration.test.ts' },
  { id: 'ADM-07.A05', page: 'ADM-07', route: '/admin/tickets/{id}', method: 'POST', endpoint: '/admin/tickets/{id}/resolve', permission: 'support.manage', status: 'implemented', part: 'PART-13', testRef: 'tests/operations.integration.test.ts' },

  { id: 'ADM-09.A01', page: 'ADM-09', route: '/admin/operations', method: 'POST', endpoint: '/admin/jobs/{id}/retry', permission: 'ops.jobs.manage', status: 'implemented', part: 'PART-13', testRef: 'tests/operations.integration.test.ts' },
  { id: 'ADM-09.A02', page: 'ADM-09', route: '/admin/operations', method: 'GET', endpoint: '/admin/incidents/{id}', permission: 'ops.read', status: 'implemented', part: 'PART-13', testRef: 'tests/operations.integration.test.ts' },
  { id: 'ADM-09.A03', page: 'ADM-09', route: '/admin/operations', method: 'POST', endpoint: '/admin/feature-flags/{id}/change-requests', permission: 'platform.release.manage', status: 'implemented', part: 'PART-13', testRef: 'tests/operations.integration.test.ts' },
  { id: 'ADM-09.A04', page: 'ADM-09', route: '/admin/operations', method: 'POST', endpoint: '/admin/restore-drills', permission: 'ops.manage', status: 'implemented', part: 'PART-13', testRef: 'tests/operations.integration.test.ts' },

  // The local simulate page and the provider webhook carry no action ID: neither is a catalogue
  // screen. The simulate page exists only because this build has no gateway, and the webhook is
  // called by a provider rather than by a person. Both are documented in docs/qa/part-06.
] as const;

export function actionById(id: string): ActionEntry | undefined {
  return ACTION_MANIFEST.find(entry => entry.id === id);
}

export function implementedActions(): ActionEntry[] {
  return ACTION_MANIFEST.filter(entry => entry.status === 'implemented');
}

/** The honest gap list: what the screens promise that the product cannot yet do. */
export function unavailableActions(): ActionEntry[] {
  return ACTION_MANIFEST.filter(entry => entry.status === 'unavailable');
}

/**
 * The HTTP contract for the routes that exist today. It is hand-written rather than generated
 * because the controllers carry no decorators, and it is held to the implementation by a drift
 * test (tests/openapi.integration.test.ts) that boots the API and compares every registered route
 * against this document in both directions.
 *
 * Only implemented operations appear here. 11-API-CONTRACTS plans a much wider surface; an absent
 * path means "not built yet", never "undocumented".
 */

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

const ENVELOPE_DESCRIPTION = 'Success envelope: { data, meta? }. See 11-API-CONTRACTS.';

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const envelope = (schema: unknown) => ({ type: 'object', required: ['data'], properties: { data: schema }, additionalProperties: true });

const errorResponse = (description: string) => ({ description, content: { 'application/json': { schema: ref('ErrorEnvelope') } } });

/** Error responses every authenticated mutation can produce, so each operation lists them once. */
const commonErrors = {
  400: errorResponse('Malformed request.'),
  401: errorResponse('No valid session.'),
  403: errorResponse('Authenticated but not permitted on this object, or the request origin was rejected.'),
  404: errorResponse('Absent, or hidden from this actor.'),
  409: errorResponse('State, version or idempotency conflict.'),
  422: errorResponse('Validation or eligibility failure.')
};

interface OperationInput {
  id: string;
  summary: string;
  tag: string;
  /** Permission asserted server side, or 'public'/'self'. Documentation only; the policy layer is authoritative. */
  permission: string;
  params?: Array<{ name: string; description: string; format?: string }>;
  query?: Array<{ name: string; description: string; required?: boolean }>;
  headers?: Array<{ name: string; description: string; required?: boolean }>;
  body?: unknown;
  bodyContentType?: string;
  success?: { status: number; description: string; schema?: unknown; contentType?: string };
  /** Extra responses beyond the common set, e.g. 429 or a 304 on a cacheable read. */
  errors?: Record<number, { description: string; content?: Record<string, unknown> }>;
  public?: boolean;
}

function operation(input: OperationInput) {
  const success = input.success ?? { status: 200, description: ENVELOPE_DESCRIPTION };
  const contentType = success.contentType ?? 'application/json';
  return {
    operationId: input.id,
    summary: input.summary,
    tags: [input.tag],
    'x-permission': input.permission,
    ...(input.public ? { security: [] } : {}),
    ...(input.params?.length || input.query?.length || input.headers?.length ? {
      parameters: [
        ...(input.params ?? []).map(param => ({ name: param.name, in: 'path', required: true, description: param.description, schema: { type: 'string', ...(param.format ? { format: param.format } : {}) } })),
        ...(input.query ?? []).map(param => ({ name: param.name, in: 'query', required: param.required ?? false, description: param.description, schema: { type: 'string' } })),
        ...(input.headers ?? []).map(param => ({ name: param.name, in: 'header', required: param.required ?? true, description: param.description, schema: { type: 'string' } }))
      ]
    } : {}),
    ...(input.body ? { requestBody: { required: true, content: { [input.bodyContentType ?? 'application/json']: { schema: input.body } } } } : {}),
    responses: {
      [String(success.status)]: { description: success.description, ...(success.schema ? { content: { [contentType]: { schema: success.schema } } } : {}) },
      ...commonErrors,
      ...(input.errors ?? {})
    }
  };
}

const uuidParam = (name: string, description: string) => ({ name, description, format: 'uuid' });
const tokenParam = (name: string, description: string) => ({ name, description });
const versionBody = (description: string) => ({ type: 'object', required: ['version'], additionalProperties: false, properties: { version: { type: 'integer', minimum: 1, description } } });
const uploadTokenHeader = [{ name: 'x-upload-token', description: 'Single-use upload token issued by the matching upload-intent call.' }];

const browseFilters = [
  { name: 'type', description: 'charity | venture | enablement.' },
  { name: 'cityId', description: 'Reference city identifier.' },
  { name: 'country', description: 'Two-letter country code.' },
  { name: 'organization', description: 'Public organisation slug.' },
  { name: 'verified', description: 'true restricts to currently verified organisations.' },
  { name: 'q', description: 'Free text matched against the public title and summary only.' },
  { name: 'cursor', description: 'Opaque cursor from the previous page.' },
  { name: 'limit', description: 'Page size, 1-100, default 20.' }
];

const schemas = {
  ErrorEnvelope: {
    type: 'object', required: ['error'],
    description: 'Errors never carry stack traces, secrets or private identity (12-SECURITY-TRUST-PRIVACY).',
    properties: { error: { type: 'object', required: ['code'], properties: { code: { type: 'string', description: 'Stable machine code, e.g. forbidden, conflict, invalid_input, mfa_unavailable.' } }, additionalProperties: false } },
    additionalProperties: false
  },
  Capability: { type: 'string', enum: ['Donor', 'Beneficiary', 'JobSeeker', 'Investor', 'Volunteer'] },
  MembershipRole: { type: 'string', enum: ['Owner', 'OrgAdmin', 'ProjectManager', 'FinanceMaker', 'FinanceApprover', 'Recruiter', 'ProgramManager', 'Trainer', 'InvestmentManager', 'Analyst', 'Viewer'] },
  PlatformRole: { type: 'string', enum: ['Support', 'VerificationReviewer', 'ContentReviewer', 'FinanceOperator', 'RiskReviewer', 'PlatformAdmin', 'Auditor'] },
  OrganizationType: { type: 'string', enum: ['NGO', 'Company', 'Startup', 'Foundation', 'Institution'] },
  VerificationState: { type: 'string', enum: ['not_started', 'submitted', 'in_review', 'changes_requested', 'verified', 'rejected', 'expired'] },
  ScanState: { type: 'string', enum: ['pending_scan', 'clean', 'rejected'] },
  Profile: {
    type: 'object',
    properties: {
      userId: { type: 'string', format: 'uuid' }, displayName: { type: 'string' },
      locale: { type: 'string', enum: ['ar', 'en'] }, city: { type: ['string', 'null'] },
      capabilities: { type: 'array', items: ref('Capability') },
      version: { type: 'integer', description: 'Optimistic concurrency token; a stale value returns 409.' }
    }
  },
  Me: {
    type: 'object',
    description: 'The signed-in human, their profile, their organisation contexts and any platform grants.',
    properties: {
      user: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string' }, email: { type: 'string', format: 'email' }, twoFactorEnabled: { type: 'boolean' } } },
      profile: ref('Profile'),
      contexts: { type: 'array', items: { type: 'object', properties: { organization: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, displayName: { type: 'string' }, type: ref('OrganizationType') } }, roles: { type: 'array', items: ref('MembershipRole') }, permissions: { type: 'array', items: { type: 'string' } } } } },
      platformRoles: { type: 'array', items: ref('PlatformRole') }
    }
  },
  Organization: {
    type: 'object',
    description: 'Organisation as seen by a member holding organization.read. legalName is never in a public projection.',
    properties: {
      id: { type: 'string', format: 'uuid' }, displayName: { type: 'string' }, legalName: { type: 'string' },
      slug: { type: 'string' }, publicDescription: { type: 'string' }, sectors: { type: 'array', items: { type: 'string' } },
      contactEmail: { type: ['string', 'null'] }, websiteUrl: { type: ['string', 'null'] }, contactAddress: { type: ['string', 'null'] },
      type: ref('OrganizationType'), country: { type: 'string', minLength: 2, maxLength: 2 }, city: { type: 'string' },
      verification: ref('VerificationState'), version: { type: 'integer' },
      currentLogoId: { type: ['string', 'null'], format: 'uuid' }, logoUrl: { type: ['string', 'null'] }
    }
  },
  PublicOrganization: {
    type: 'object',
    description: 'Allowlisted public projection. It deliberately omits legalName, storage keys and checksums.',
    properties: {
      id: { type: 'string', format: 'uuid' }, displayName: { type: 'string' }, slug: { type: 'string' },
      logoUrl: { type: ['string', 'null'] }, publicDescription: { type: 'string' },
      sectors: { type: 'array', items: { type: 'string' } }, contactEmail: { type: ['string', 'null'] },
      websiteUrl: { type: ['string', 'null'] }, contactAddress: { type: ['string', 'null'] },
      type: ref('OrganizationType'), country: { type: 'string' }, city: { type: 'string' }, verification: ref('VerificationState')
    }
  },
  Member: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' }, userId: { type: 'string', format: 'uuid' },
      roles: { type: 'array', items: ref('MembershipRole') }, status: { type: 'string', enum: ['active', 'suspended'] },
      version: { type: 'integer' }, user: { type: 'object', properties: { name: { type: 'string' }, email: { type: 'string' } } }
    }
  },
  Invitation: {
    type: 'object',
    description: 'The invitation token is never returned over HTTP; it reaches the recipient through the delivery adapter only.',
    properties: {
      id: { type: 'string', format: 'uuid' }, email: { type: 'string' }, roles: { type: 'array', items: ref('MembershipRole') },
      expiresAt: { type: 'string', format: 'date-time' }, consumedAt: { type: ['string', 'null'], format: 'date-time' },
      revokedAt: { type: ['string', 'null'], format: 'date-time' }, declinedAt: { type: ['string', 'null'], format: 'date-time' },
      createdAt: { type: 'string', format: 'date-time' }
    }
  },
  InvitationPreview: {
    type: 'object',
    description: 'Returned only to a signed-in, email-verified recipient whose address matches the invitation.',
    properties: {
      organization: { type: 'object', properties: { displayName: { type: 'string' }, type: ref('OrganizationType'), country: { type: 'string' }, city: { type: 'string' } } },
      inviter: { type: 'object', properties: { name: { type: 'string' } } },
      roles: { type: 'array', items: ref('MembershipRole') }, expiresAt: { type: 'string', format: 'date-time' },
      status: { type: 'string', enum: ['pending', 'accepted', 'declined', 'revoked', 'expired'] }
    }
  },
  VerificationCase: {
    type: 'object',
    properties: {
      id: { type: ['string', 'null'], format: 'uuid' }, state: ref('VerificationState'), version: { type: 'integer' },
      registrationNumber: { type: 'string' }, issuingAuthority: { type: 'string' }, registeredAddress: { type: 'string' },
      documentExpiresAt: { type: ['string', 'null'], format: 'date' },
      documents: { type: 'array', items: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, fileName: { type: 'string' }, scanState: ref('ScanState'), scanReason: { type: ['string', 'null'] }, createdAt: { type: 'string', format: 'date-time' } } } },
      submissions: { type: 'array', items: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, sequence: { type: 'integer' }, submittedAt: { type: 'string', format: 'date-time' } } } }
    }
  },
  VerificationDecision: {
    type: 'object',
    description: 'The organisation-facing decision. reviewerId is intentionally absent (ADR-013).',
    properties: {
      id: { type: 'string', format: 'uuid' }, outcome: { type: 'string', enum: ['changes_requested', 'verified', 'rejected'] },
      publicReason: { type: 'string' }, decidedAt: { type: 'string', format: 'date-time' },
      submission: { type: 'object', properties: { sequence: { type: 'integer' } } }
    }
  },
  UploadIntent: {
    type: 'object',
    description: 'Single-use, 15-minute upload grant. The token is stored only as a SHA-256 digest.',
    properties: {
      id: { type: 'string', format: 'uuid' }, token: { type: 'string' }, expiresAt: { type: 'string', format: 'date-time' },
      uploadPath: { type: 'string' }, finalizePath: { type: 'string' }, maximumSize: { type: 'integer' }
    }
  },
  AccountSession: {
    type: 'object',
    description: 'Session metadata only. The session token and its digest are never returned (ADR-012).',
    properties: {
      id: { type: 'string', format: 'uuid' }, createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' }, expiresAt: { type: 'string', format: 'date-time' },
      ipAddress: { type: ['string', 'null'] }, userAgent: { type: ['string', 'null'] },
      activeOrganizationId: { type: ['string', 'null'], format: 'uuid' }, current: { type: 'boolean' }
    }
  },
  MfaChallenge: {
    type: 'object',
    description: 'Five-minute challenge bound to actor, session, operation, resource and resource version; consumed once.',
    properties: {
      id: { type: 'string', format: 'uuid' }, operation: { type: 'string' }, resourceId: { type: 'string', format: 'uuid' },
      resourceVersion: { type: 'integer' }, expiresAt: { type: 'string', format: 'date-time' },
      state: { type: 'string', enum: ['pending', 'verified', 'consumed', 'cancelled'] }
    }
  },
  BankAccountSummary: {
    type: 'object',
    description: 'Only the last four characters are ever exposed. The identifier is stored encrypted (ADR-018).',
    properties: {
      id: { type: 'string', format: 'uuid' }, bankName: { type: 'string' }, accountHolder: { type: 'string' },
      accountLast4: { type: 'string', maxLength: 4 }, country: { type: 'string' }, currency: { type: 'string' },
      updatedAt: { type: 'string', format: 'date-time' }
    }
  },
  BankChangeRequest: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' }, bankName: { type: 'string' }, accountHolder: { type: 'string' },
      accountLast4: { type: 'string', maxLength: 4 }, country: { type: 'string' }, currency: { type: 'string' },
      state: { type: 'string', enum: ['pending', 'approved', 'rejected'] }, version: { type: 'integer' },
      reviewReason: { type: 'string' }, createdAt: { type: 'string', format: 'date-time' },
      reviewedAt: { type: ['string', 'null'], format: 'date-time' }
    }
  },
  PlatformTeam: {
    type: 'object',
    description: 'Platform grants are temporary and separate from organisation membership (ADR-016).',
    properties: {
      members: { type: 'array', items: { type: 'object', properties: { user: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string' }, email: { type: 'string' }, twoFactorEnabled: { type: 'boolean' }, platformAccessVersion: { type: 'integer' } } }, grants: { type: 'array', items: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, role: ref('PlatformRole'), expiresAt: { type: ['string', 'null'], format: 'date-time' } } } } } } },
      invitations: { type: 'array', items: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, email: { type: 'string' }, roles: { type: 'array', items: ref('PlatformRole') }, grantExpiresAt: { type: 'string', format: 'date-time' }, expiresAt: { type: 'string', format: 'date-time' }, createdAt: { type: 'string', format: 'date-time' } } } }
    }
  },
  ProjectType: { type: 'string', enum: ['charity', 'venture', 'enablement'], description: 'Fixed once the project is published (01-PRODUCT-SCOPE); a new funding model means a linked project.' },
  ProjectState: { type: 'string', enum: ['draft', 'submitted', 'in_review', 'changes_requested', 'approved', 'published', 'funding_closed', 'executing', 'impact_review', 'completed', 'archived', 'paused', 'cancelled', 'rejected'] },
  LocationPrecision: {
    type: 'string', enum: ['city', 'approximate', 'exact'],
    description: 'How precisely the project may be located publicly. `city` stores no point at all; `approximate` is rounded to about a kilometre; `exact` is only ever a public facility, never a beneficiary address (12-SECURITY).'
  },
  City: {
    type: 'object',
    properties: { id: { type: 'string', format: 'uuid' }, country: { type: 'string', minLength: 2, maxLength: 2 }, nameAr: { type: 'string' }, nameEn: { type: 'string' } }
  },
  CursorPage: {
    type: 'object',
    description: 'Stable cursor paging (11-API-CONTRACTS): ordered by publication then id, so a page cannot skip or repeat a row.',
    properties: { nextCursor: { type: ['string', 'null'], format: 'uuid' }, hasMore: { type: 'boolean' } }
  },
  PublicLocation: {
    type: 'object',
    description: 'A point is present only at the precision the project declared; otherwise the city centre stands in for it.',
    properties: {
      city: { type: 'object', properties: { nameAr: { type: 'string' }, nameEn: { type: 'string' }, country: { type: 'string' } } },
      point: { oneOf: [{ type: 'object', properties: { latitude: { type: 'number' }, longitude: { type: 'number' } } }, { type: 'null' }] },
      precision: ref('LocationPrecision')
    }
  },
  PublicOrganizationSummary: {
    type: 'object',
    description: 'Allowlisted. The legal name is never part of a public projection.',
    properties: {
      slug: { type: 'string' }, displayName: { type: 'string' }, type: ref('OrganizationType'),
      city: { type: 'string' }, country: { type: 'string' },
      verified: { type: 'boolean', description: 'True only for a current verification; an expired one is not verified.' },
      logoUrl: { type: ['string', 'null'] }
    }
  },
  PublicOrganizationProfile: {
    allOf: [ref('PublicOrganizationSummary'), {
      type: 'object',
      properties: {
        publicDescription: { type: 'string' }, sectors: { type: 'array', items: { type: 'string' } },
        websiteUrl: { type: ['string', 'null'] }, contactEmail: { type: ['string', 'null'] },
        projects: { type: 'array', items: ref('PublicProjectCard') }
      }
    }]
  },
  PublicProjectCard: {
    type: 'object',
    description: 'Built field by field, so adding a column to the projects table can never widen what a visitor sees. Carries no financial figure and no internal identifier.',
    properties: {
      slug: { type: 'string' }, title: { type: 'string' }, summary: { type: 'string' },
      type: ref('ProjectType'), state: ref('ProjectState'),
      publishedAt: { type: ['string', 'null'], format: 'date-time' },
      organization: ref('PublicOrganizationSummary'), location: ref('PublicLocation')
    }
  },
  PublicProjectDetail: {
    allOf: [ref('PublicProjectCard'), {
      type: 'object',
      properties: {
        story: { type: 'string' },
        funding: {
          type: 'object',
          description: 'Says whether a funding figure exists at all, so a reader can tell "no money module yet" from "nothing raised".',
          properties: { available: { type: 'boolean' }, reason: { type: 'string' } }
        }
      }
    }]
  },
  ImpactSummary: {
    type: 'object',
    description: 'Every figure carries its definition (14-ANALYTICS). Figures no module can produce are listed as unavailable rather than reported as zero.',
    properties: {
      asOf: { type: 'string', format: 'date-time' },
      counted: { type: 'array', items: { type: 'object', properties: { key: { type: 'string' }, value: { type: 'integer' }, definition: { type: 'string' } } } },
      unavailable: { type: 'array', items: { type: 'object', properties: { key: { type: 'string' }, reason: { type: 'string' }, part: { type: 'string' } } } }
    }
  },
  OrganizationProjectRow: {
    type: 'object',
    description: 'The organisation-side view, which unlike the public one may include drafts and the responsible manager.',
    properties: {
      id: { type: 'string', format: 'uuid' }, slug: { type: 'string' }, title: { type: 'string' },
      summary: { type: 'string' }, type: ref('ProjectType'), state: ref('ProjectState'),
      version: { type: 'integer' }, publishedAt: { type: ['string', 'null'], format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' }
    }
  },
  ProjectInput: {
    type: 'object',
    required: ['title', 'summary', 'story', 'cityId', 'managerId', 'publicLocationPrecision', 'latitude', 'longitude'],
    properties: {
      type: ref('ProjectType'),
      title: { type: 'string', minLength: 5, maxLength: 140 },
      summary: { type: 'string', maxLength: 300, description: 'At least 30 characters before the project may be submitted for review.' },
      story: { type: 'string', maxLength: 20000 },
      cityId: { type: 'string', format: 'uuid' },
      managerId: { type: 'string', format: 'uuid', description: 'Must be an active member of the owning organisation.' },
      publicLocationPrecision: ref('LocationPrecision'),
      latitude: { type: ['number', 'null'], description: 'Must be null when the precision is `city`: what is not stored cannot leak.' },
      longitude: { type: ['number', 'null'] }
    }
  },
  MinorAmount: {
    type: 'string', pattern: '^[0-9]{1,16}$',
    description: 'An integer count of the currency’s smallest unit, carried as a decimal string. Never a JSON number: 08-FINANCIAL-SYSTEM forbids relying on JavaScript number precision for money. "125050" in a two-decimal currency means 1,250.50.'
  },
  FundingPolicy: {
    type: 'string', enum: ['flexible', 'all_or_nothing'],
    description: 'Fixed once the project is published, because a contributor decides whether to give based on what happens if the goal is missed.'
  },
  MilestoneState: { type: 'string', enum: ['planned', 'active', 'evidence_submitted', 'verified', 'cancelled'] },
  ReviewOutcome: { type: 'string', enum: ['approved', 'changes_requested', 'rejected'] },
  ReportState: { type: 'string', enum: ['draft', 'submitted', 'published'] },
  Campaign: {
    type: 'object',
    properties: {
      goalMinor: ref('MinorAmount'), currency: { type: 'string', minLength: 3, maxLength: 3 },
      policy: ref('FundingPolicy'), endsAt: { type: 'string', format: 'date-time' }, version: { type: 'integer' }
    }
  },
  CampaignInput: {
    type: 'object', required: ['goalMinor', 'currency', 'policy', 'endsAt', 'version'], additionalProperties: false,
    properties: {
      goalMinor: ref('MinorAmount'), currency: { type: 'string', pattern: '^[A-Za-z]{3}$' },
      policy: ref('FundingPolicy'), endsAt: { type: 'string', format: 'date-time' }, version: { type: 'integer', minimum: 1 }
    }
  },
  BudgetInput: {
    type: 'object', required: ['lines', 'reason', 'version'], additionalProperties: false,
    properties: {
      lines: { type: 'array', minItems: 1, maxItems: 60, items: { type: 'object', required: ['label', 'amountMinor'], additionalProperties: false, properties: { label: { type: 'string', minLength: 2, maxLength: 140 }, amountMinor: ref('MinorAmount') } } },
      reason: { type: 'string', maxLength: 1000, description: 'At least 10 characters once the project is published: redirecting committed money is not an ordinary text edit.' },
      version: { type: 'integer', minimum: 1 }
    }
  },
  MilestonesInput: {
    type: 'object', required: ['milestones', 'version'], additionalProperties: false,
    properties: {
      milestones: { type: 'array', minItems: 1, maxItems: 40, items: { type: 'object', required: ['title', 'budgetMinor', 'weight'], additionalProperties: false, properties: { title: { type: 'string', minLength: 2, maxLength: 140 }, budgetMinor: ref('MinorAmount'), weight: { type: 'integer', minimum: 1, maximum: 100 } } } },
      version: { type: 'integer', minimum: 1 }
    }
  },
  ReasonedVersion: {
    type: 'object', required: ['reason', 'version'], additionalProperties: false,
    properties: { reason: { type: 'string', minLength: 10, maxLength: 1000 }, version: { type: 'integer', minimum: 1 } }
  },
  ProjectStateResult: {
    type: 'object',
    properties: { state: ref('ProjectState'), version: { type: 'integer' } }
  },
  ProjectPlan: {
    type: 'object',
    description: 'The organisation-side plan. Amounts are planning figures, not balances: `funding.available` is false until the ledger exists.',
    properties: {
      id: { type: 'string', format: 'uuid' }, slug: { type: 'string' }, title: { type: 'string' },
      state: ref('ProjectState'), stateReason: { type: 'string' }, version: { type: 'integer' },
      publishedAt: { type: ['string', 'null'], format: 'date-time' },
      campaign: { oneOf: [ref('Campaign'), { type: 'null' }] },
      budget: {
        type: 'object',
        properties: {
          lines: { type: 'array', items: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, label: { type: 'string' }, amountMinor: ref('MinorAmount'), sortOrder: { type: 'integer' } } } },
          totalMinor: ref('MinorAmount'),
          revisions: { type: 'array', items: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, sequence: { type: 'integer' }, reason: { type: 'string' }, totalMinor: ref('MinorAmount'), createdAt: { type: 'string', format: 'date-time' } } } }
        }
      },
      milestones: { type: 'array', items: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, sequence: { type: 'integer' }, title: { type: 'string' }, budgetMinor: ref('MinorAmount'), weight: { type: 'integer' }, state: ref('MilestoneState') } } },
      milestoneTotalMinor: ref('MinorAmount'),
      readiness: {
        type: 'object',
        description: 'Why the project cannot yet be submitted, as named reasons rather than one opaque boolean.',
        properties: { ready: { type: 'boolean' }, blockers: { type: 'array', items: { type: 'string' } } }
      },
      funding: { type: 'object', properties: { available: { type: 'boolean' }, reason: { type: 'string' } } }
    }
  },
  ProjectReport: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' }, sequence: { type: 'integer' }, title: { type: 'string' },
      state: ref('ReportState'), version: { type: 'integer' },
      publishedAt: { type: ['string', 'null'], format: 'date-time' }
    }
  },
  ReportMetrics: {
    type: 'object',
    description: 'Each figure carries its definition; figures with no source are listed as unavailable rather than reported as zero (14-ANALYTICS).',
    properties: {
      counted: { type: 'array', items: { type: 'object', properties: { key: { type: 'string' }, value: { type: 'string' }, definition: { type: 'string' } } } },
      unavailable: { type: 'array', items: { type: 'object', properties: { key: { type: 'string' }, reason: { type: 'string' }, part: { type: 'string' } } } }
    }
  },

  // ---- PART-06: money -------------------------------------------------------------------------
  // Every amount below is an integer count of minor units carried as a decimal string. No money
  // crosses this API as a number, because JSON numbers are doubles (ADR-004).
  MinorUnits: { type: 'string', pattern: '^[0-9]{1,16}$', description: 'Integer minor units as a decimal string, e.g. "10000" for 100.00.' },
  SignedMinorUnits: { type: 'string', pattern: '^-?[0-9]{1,16}$', description: 'Integer minor units, which a derived balance may make negative.' },
  ContributionVisibility: { type: 'string', enum: ['named', 'anonymous'] },
  ContributionState: { type: 'string', enum: ['pending', 'succeeded', 'failed', 'expired', 'refunded', 'partially_refunded'] },
  PaymentIntentState: { type: 'string', enum: ['created', 'awaiting_action', 'processing', 'succeeded', 'failed', 'expired'] },

  ContributionQuote: {
    type: 'object',
    description: 'What the payer will be charged and what reaches the project. Advisory: the server recomputes the fee at submission and refuses a stale quote.',
    properties: {
      projectSlug: { type: 'string' }, projectTitle: { type: 'string' }, organization: { type: 'string' },
      currency: { type: 'string' },
      amountMinor: ref('MinorUnits'),
      feeMinor: ref('MinorUnits'),
      netToProjectMinor: ref('MinorUnits'),
      goalMinor: ref('MinorUnits'),
      remainingCapacityMinor: ref('MinorUnits'),
      policy: { type: 'string', description: 'Campaign funding policy, e.g. all_or_nothing or keep_what_you_raise.' },
      exceedsCapacity: { type: 'boolean', description: 'true when the amount is larger than the room left before the goal; overfunding is refused by default.' },
      simulated: { type: 'boolean', const: true, description: 'Always true in this build: the fee schedule and the provider are simulated.' }
    }
  },
  ContributionInput: {
    type: 'object',
    required: ['projectSlug', 'amountMinor', 'visibility', 'showAmountPublicly', 'acceptedQuoteFeeMinor'],
    additionalProperties: false,
    properties: {
      projectSlug: { type: 'string', minLength: 1, maxLength: 120 },
      amountMinor: ref('MinorUnits'),
      visibility: ref('ContributionVisibility'),
      showAmountPublicly: { type: 'boolean', description: 'A separate choice from being named; an anonymous amount is never published.' },
      acceptedQuoteFeeMinor: { ...ref('MinorUnits'), description: 'The fee the payer was shown. A mismatch with the recomputed fee is a 409.' }
    }
  },
  CreatedContribution: {
    type: 'object',
    description: 'A reservation and an open payment intent. It is not a payment, and nothing is confirmed until a signed provider event arrives.',
    properties: {
      contributionId: { type: 'string', format: 'uuid' },
      paymentIntentId: { type: 'string', format: 'uuid' },
      status: ref('PaymentIntentState'),
      providerRedirectPath: { type: 'string', description: 'Where to send the payer. Always inside this app, because there is no gateway in this build.' },
      expiresAt: { type: 'string', format: 'date-time', description: 'When the reservation lapses and the capacity returns to the project.' },
      amountMinor: ref('MinorUnits'), feeMinor: ref('MinorUnits'), currency: { type: 'string' },
      simulated: { type: 'boolean', const: true }
    }
  },
  MyContribution: {
    type: 'object',
    description: 'The contributor’s own record. Their own identity and amounts are always visible to them, whatever they chose to publish.',
    properties: {
      id: { type: 'string', format: 'uuid' },
      project: { type: 'object', properties: { slug: { type: 'string' }, title: { type: 'string' } } },
      state: ref('ContributionState'),
      amountMinor: ref('MinorUnits'), feeMinor: ref('MinorUnits'), refundedMinor: ref('MinorUnits'),
      currency: { type: 'string' },
      visibility: ref('ContributionVisibility'), showAmountPublicly: { type: 'boolean' },
      confirmedAt: { type: ['string', 'null'], format: 'date-time' },
      createdAt: { type: 'string', format: 'date-time' },
      version: { type: 'integer' },
      intent: { type: ['object', 'null'], properties: { id: { type: 'string', format: 'uuid' }, state: ref('PaymentIntentState') } },
      simulated: { type: 'boolean' }
    }
  },
  PublicContributor: {
    type: 'object',
    description: 'Built field by field. An anonymous contributor’s name is never placed in the object, and an amount appears only where the contributor consented to it separately.',
    properties: {
      id: { type: 'string', format: 'uuid' },
      name: { type: ['string', 'null'] },
      anonymous: { type: 'boolean' },
      amountMinor: { anyOf: [ref('MinorUnits'), { type: 'null' }] },
      currency: { type: 'string' },
      confirmedAt: { type: ['string', 'null'], format: 'date-time' }
    }
  },
  PaymentIntentStatus: {
    type: 'object',
    description: 'Read from our own record. A return from the payment page is not proof of payment (00-MASTER-PROMPT).',
    properties: {
      id: { type: 'string', format: 'uuid' },
      state: ref('PaymentIntentState'),
      contributionId: { type: 'string', format: 'uuid' },
      contributionState: ref('ContributionState'),
      amountMinor: ref('MinorUnits'), currency: { type: 'string' },
      expiresAt: { type: 'string', format: 'date-time' },
      project: { type: 'object', properties: { slug: { type: 'string' }, title: { type: 'string' } } },
      awaitingProvider: { type: 'boolean', description: 'true while the provider has not confirmed; the page must not imply success.' },
      simulated: { type: 'boolean' }
    }
  },
  LedgerBalances: {
    type: 'object',
    description: 'Derived from the ledger entries on every read. Nothing here is a stored total, so a balance cannot drift from the journal (FIN-06).',
    properties: {
      currency: { type: 'string' },
      grossReceivedMinor: ref('SignedMinorUnits'),
      feesMinor: ref('SignedMinorUnits'),
      refundedMinor: { ...ref('SignedMinorUnits'), description: 'Money actually returned to contributors, not money a refund has merely been approved for.' },
      netConfirmedMinor: ref('SignedMinorUnits'),
      availableMinor: { ...ref('SignedMinorUnits'), description: 'Settled cash minus what is already promised out. Not the same figure as net confirmed funding.' },
      heldMinor: ref('SignedMinorUnits'),
      inProviderClearingMinor: { ...ref('SignedMinorUnits'), description: 'Confirmed by the provider but not yet settled into the bank account.' },
      restrictedMinor: { ...ref('SignedMinorUnits'), description: 'Owed to the project’s declared purpose; a liability, never income. Under the declared fee policy a reservation moves the obligation to payout payable, so once everything has settled this equals availableMinor seen from the other side of the books.' },
      feesAbsorbedByPlatformMinor: { ...ref('SignedMinorUnits'), description: 'Non-zero only where the platform absorbed a fee instead of charging it to the pool.' },
      refundsPendingMinor: { ...ref('SignedMinorUnits'), description: 'Approved refunds holding cash that is therefore no longer available to spend.' },
      disputedMinor: { ...ref('SignedMinorUnits'), description: 'Owed back on a chargeback.' },
      shortfallMinor: { ...ref('SignedMinorUnits'), description: 'Set when the pool owes more than it holds. 08 forbids hiding this by clamping a balance, so it is reported as its own figure.' }
    }
  },
  LedgerTransaction: {
    type: 'object',
    description: 'Append-only. A correction is posted as a reversal, never as an edit (enforced in SQL).',
    properties: {
      id: { type: 'string', format: 'uuid' },
      sourceType: { type: 'string' }, sourceId: { type: ['string', 'null'] },
      reversalOf: { type: ['string', 'null'], format: 'uuid' },
      postedAt: { type: 'string', format: 'date-time' },
      currency: { type: 'string' },
      entries: { type: 'array', items: { type: 'object', properties: { account: { type: 'string' }, type: { type: 'string' }, debitMinor: ref('MinorUnits'), creditMinor: ref('MinorUnits') } } }
    }
  },
  ProjectFinance: {
    type: 'object',
    description: 'The organisation’s own financial view. Contributor identities are not part of this read; reaching one needs a separate, audited permission.',
    properties: {
      hasPool: { type: 'boolean', description: 'false before any funding pool exists, in which case the balances are null rather than zero.' },
      balances: { anyOf: [ref('LedgerBalances'), { type: 'null' }] },
      journal: { type: 'array', items: ref('LedgerTransaction') },
      contributors: { type: 'array', items: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, state: ref('ContributionState'), amountMinor: ref('MinorUnits'), feeMinor: ref('MinorUnits'), currency: { type: 'string' }, anonymous: { type: 'boolean' }, confirmedAt: { type: ['string', 'null'], format: 'date-time' }, createdAt: { type: 'string', format: 'date-time' } } } }
    }
  },
  ProviderEvent: {
    type: 'object',
    required: ['eventId', 'eventType', 'providerReference', 'amountMinor', 'currency', 'occurredAt'],
    description: 'A provider’s statement about a payment. The event id is the idempotency key, and occurredAt is when the provider says it happened, not when we received it.',
    properties: {
      eventId: { type: 'string' },
      eventType: { type: 'string', enum: ['payment.succeeded', 'payment.failed', 'payment.settled'], description: '`payment.settled` is a second, later fact about the same payment: the money reached the bank and is spendable. 08 keeps it apart from `payment.succeeded`, because a payout made against money that has only been authorised is a payout made against money that is not there.' },
      providerReference: { type: 'string' },
      amountMinor: ref('MinorUnits'),
      currency: { type: 'string', pattern: '^[A-Z]{3}$' },
      occurredAt: { type: 'string', format: 'date-time' }
    }
  },

  // ---- PART-07: payouts, refunds, disputes and reconciliation ---------------------------------
  PayoutState: { type: 'string', enum: ['requested', 'approved', 'rejected', 'cancelled', 'queued', 'processing', 'paid', 'failed', 'unknown'], description: '`unknown` is terminal until an inquiry resolves it; it is never retried blindly.' },
  RefundState: { type: 'string', enum: ['requested', 'approved', 'rejected', 'processing', 'succeeded', 'failed', 'unknown'] },
  DisputeState: { type: 'string', enum: ['opened', 'under_review', 'lost', 'won', 'withdrawn'] },
  ReconciliationMatch: { type: 'string', enum: ['match', 'mismatch', 'missing', 'duplicate'] },

  PayoutInput: {
    type: 'object',
    required: ['projectId', 'amountMinor', 'reason'],
    additionalProperties: false,
    description: 'The beneficiary is not chosen here: money goes to the organisation’s currently verified bank account, and the request records a snapshot of it.',
    properties: {
      projectId: { type: 'string', format: 'uuid' },
      milestoneId: { type: ['string', 'null'], format: 'uuid' },
      amountMinor: ref('MinorUnits'),
      reason: { type: 'string', minLength: 10, maxLength: 1000 },
      invoiceReference: { type: 'string', maxLength: 120 }
    }
  },
  Payout: {
    type: 'object',
    description: 'A disbursement request and everything decided about it. The bank identifier is never present — only the last four digits, which is what a person needs to recognise the account.',
    properties: {
      id: { type: 'string', format: 'uuid' },
      projectId: { type: 'string', format: 'uuid' },
      organizationId: { type: 'string', format: 'uuid' },
      milestoneId: { type: ['string', 'null'], format: 'uuid' },
      amountMinor: ref('MinorUnits'),
      currency: { type: 'string' },
      reason: { type: 'string' },
      invoiceReference: { type: 'string' },
      state: ref('PayoutState'),
      requestHash: { type: 'string', description: 'SHA-256 of the material terms. An approval is bound to this value; changing any term voids it.' },
      beneficiary: { type: 'object', properties: { bankName: { type: 'string' }, holder: { type: 'string' }, last4: { type: 'string' } } },
      makerId: { type: 'string', format: 'uuid' },
      approverId: { type: ['string', 'null'], format: 'uuid', description: 'Never equal to makerId; enforced by the policy layer and by a CHECK constraint.' },
      approvedAt: { type: ['string', 'null'], format: 'date-time' },
      providerReference: { type: ['string', 'null'] },
      paidProofReference: { type: ['string', 'null'], description: 'Independent evidence the money left, which `approved` is not. Present only once paid.' },
      paidAt: { type: ['string', 'null'], format: 'date-time' },
      failureReason: { type: 'string' },
      lastInquiredAt: { type: ['string', 'null'], format: 'date-time' },
      awaitingProvider: { type: 'boolean', description: 'true while only the provider can say what happened; the UI must offer no retry.' },
      needsInquiry: { type: 'boolean', description: 'true when the outcome is unknown and an inquiry is the only way forward.' },
      simulated: { type: 'boolean' },
      version: { type: 'integer' },
      createdAt: { type: 'string', format: 'date-time' }
    }
  },
  PayoutDetail: {
    allOf: [ref('Payout'), {
      type: 'object',
      properties: {
        project: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, slug: { type: 'string' }, title: { type: 'string' } } },
        milestone: { type: ['object', 'null'], properties: { id: { type: 'string', format: 'uuid' }, title: { type: 'string' }, sequence: { type: 'integer' } } },
        decisions: {
          type: 'array',
          description: 'Append-only. Each decision carries whether it was made against the request as it now stands.',
          items: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, action: { type: 'string' }, actor: { type: 'string' }, reason: { type: 'string' }, at: { type: 'string', format: 'date-time' }, matchesCurrentRequest: { type: 'boolean' } } }
        }
      }
    }]
  },
  Refund: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      contributionId: { type: 'string', format: 'uuid' },
      amountMinor: ref('MinorUnits'),
      currency: { type: 'string' },
      reason: { type: 'string' },
      state: ref('RefundState'),
      feeCoveredByPool: { type: 'boolean' },
      feeMinor: { ...ref('MinorUnits'), description: 'The processor keeps its fee on a refund, so a full return costs the pool this much more than the net.' },
      requestedBy: { type: 'string', format: 'uuid' },
      approverId: { type: ['string', 'null'], format: 'uuid' },
      approvedAt: { type: ['string', 'null'], format: 'date-time' },
      providerReference: { type: ['string', 'null'] },
      succeededAt: { type: ['string', 'null'], format: 'date-time' },
      failureReason: { type: 'string' },
      lastInquiredAt: { type: ['string', 'null'], format: 'date-time' },
      awaitingProvider: { type: 'boolean' },
      needsInquiry: { type: 'boolean' },
      simulated: { type: 'boolean' },
      version: { type: 'integer' },
      createdAt: { type: 'string', format: 'date-time' },
      remainingRefundableMinor: ref('MinorUnits')
    }
  },
  RefundList: {
    type: 'object',
    properties: {
      remainingRefundableMinor: { ...ref('MinorUnits'), description: 'Received, less confirmed refunds, less what pending refunds already hold.' },
      nonRefundableFeeMinor: ref('MinorUnits'),
      refunds: { type: 'array', items: ref('Refund') }
    }
  },
  Dispute: {
    type: 'object',
    description: 'A chargeback after a successful payment. The original payment is not rewritten by it.',
    properties: {
      id: { type: 'string', format: 'uuid' },
      contributionId: { type: 'string', format: 'uuid' },
      amountMinor: ref('MinorUnits'),
      currency: { type: 'string' },
      state: ref('DisputeState'),
      reason: { type: 'string' },
      coveragePlan: { type: 'string', description: 'How a shortfall is to be covered where the money was already disbursed.' },
      resolvedAt: { type: ['string', 'null'], format: 'date-time' },
      version: { type: 'integer' },
      createdAt: { type: 'string', format: 'date-time' }
    }
  },
  StatementRow: {
    type: 'object',
    required: ['providerTransactionId', 'amountMinor', 'currency', 'outcome'],
    additionalProperties: false,
    properties: {
      providerTransactionId: { type: 'string', maxLength: 120 },
      amountMinor: ref('MinorUnits'),
      currency: { type: 'string', pattern: '^[A-Za-z]{3}$' },
      feeMinor: ref('MinorUnits'),
      outcome: { type: 'string', maxLength: 20 }
    }
  },
  ReconciliationItem: {
    type: 'object',
    description: 'One statement line and what matching it concluded. The provider’s figures are evidence and cannot be edited; a difference is closed with a signed reason, never by adjusting a balance.',
    properties: {
      id: { type: 'string', format: 'uuid' },
      batchId: { type: 'string', format: 'uuid' },
      providerTransactionId: { type: 'string' },
      amountMinor: ref('MinorUnits'),
      currency: { type: 'string' },
      feeMinor: ref('MinorUnits'),
      outcome: { type: 'string' },
      matchState: ref('ReconciliationMatch'),
      ourAmountMinor: { anyOf: [ref('MinorUnits'), { type: 'null' }], description: 'null where we hold no record at all, which is not the same as zero.' },
      ourFeeMinor: { anyOf: [ref('MinorUnits'), { type: 'null' }] },
      ourState: { type: ['string', 'null'] },
      note: { type: 'string', description: 'Space-separated machine codes for what differs (amount_differs, fee_differs, no_record, …), so a screen can name the difference in the reader’s language.' },
      resolvedAt: { type: ['string', 'null'], format: 'date-time' },
      resolutionReason: { type: 'string' },
      version: { type: 'integer' }
    }
  },
  ReconciliationBatch: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      source: { type: 'string' },
      environment: { type: 'string', description: 'A statement is scoped to the environment it came from; demo figures are never matched against real ones.' },
      statementDate: { type: 'string', format: 'date-time' },
      rowCount: { type: 'integer' },
      state: { type: 'string', enum: ['imported', 'matched', 'closed'] },
      lastRunAt: { type: ['string', 'null'], format: 'date-time' },
      version: { type: 'integer' },
      items: { type: 'array', items: ref('ReconciliationItem') }
    }
  },
  FinanceCentre: {
    type: 'object',
    description: 'ADM-05/ADM-06. Everything platform finance still has to act on, with what cannot be closed until the provider is asked counted rather than hidden.',
    properties: {
      reconciliation: {
        type: 'object',
        properties: {
          lastRunAt: { type: ['string', 'null'], format: 'date-time', description: 'null means reconciliation has never run, which is not the same as it finding nothing.' },
          environment: { type: 'string' },
          batches: { type: 'array', items: ref('ReconciliationBatch') },
          openItems: { type: 'array', items: ref('ReconciliationItem') },
          awaitingInquiry: { type: 'object', properties: { payouts: { type: 'integer' }, refunds: { type: 'integer' } } },
          isolatedEvents: { type: 'integer', description: 'Provider events for references we never issued, held for review rather than applied.' }
        }
      },
      payouts: { type: 'array', items: ref('Payout') },
      refunds: { type: 'array', items: ref('Refund') },
      disputes: { type: 'array', items: ref('Dispute') }
    }
  },

  // ---- PART-08: ventures, offerings, eligibility and the data room ------------------------------
  // Share counts are integers carried as strings, for the same reason money is: a JSON number is a
  // double, and a company's share register is not something to round.
  ShareCount: { type: 'string', pattern: '^[0-9]{1,16}$', description: 'A whole number of shares, as a decimal string. No fractional shares in this release (06).' },
  Percentage: { type: 'string', description: 'A percentage derived from integers and truncated to six decimals, never rounded up: a holding figure that rounds up overstates what someone owns.' },
  OfferingState: { type: 'string', enum: ['draft', 'submitted', 'due_diligence', 'changes_requested', 'rejected', 'approved', 'open', 'suspended', 'closing', 'failed', 'allocated', 'reporting', 'closed'] },
  EligibilityState: { type: 'string', enum: ['not_started', 'draft', 'submitted', 'in_review', 'changes_requested', 'approved', 'rejected', 'expired'] },
  DataRoomCategory: { type: 'string', enum: ['company_profile', 'historical_performance', 'use_of_funds', 'current_ownership', 'contracts', 'risks', 'due_diligence_report'] },
  DataRoomClassification: { type: 'string', enum: ['public', 'nda', 'granted'], description: 'public is on the offering page; nda needs a current acceptance; granted additionally needs a live per-offering grant.' },

  Venture: {
    type: 'object',
    description: 'The commercial entity behind an offering. Separate from the organisation because an organisation is a legal counterparty while a venture is the thing with share capital.',
    properties: {
      id: { type: 'string', format: 'uuid' },
      organizationId: { type: 'string', format: 'uuid' },
      legalName: { type: 'string' },
      summary: { type: 'string' },
      currentShares: ref('ShareCount'),
      currency: { type: 'string' },
      version: { type: 'integer' }
    }
  },
  OfferingInput: {
    type: 'object',
    required: ['title', 'currency', 'sharesOffered', 'pricePerShareMinor', 'minimumRaiseMinor', 'minimumTicketMinor', 'useOfFunds'],
    additionalProperties: false,
    properties: {
      title: { type: 'string', minLength: 4, maxLength: 200 },
      currency: { type: 'string', pattern: '^[A-Za-z]{3}$' },
      sharesOffered: ref('ShareCount'),
      pricePerShareMinor: ref('MinorUnits'),
      minimumRaiseMinor: { ...ref('MinorUnits'), description: 'The raise below which the offering fails. Cannot exceed what a full raise would bring in.' },
      minimumTicketMinor: { ...ref('MinorUnits'), description: 'Must buy at least one whole share, and be a whole number of them.' },
      maximumTicketMinor: { anyOf: [ref('MinorUnits'), { type: 'null' }] },
      useOfFunds: { type: 'string', minLength: 20, maxLength: 4000 },
      oversubscriptionPolicy: { type: 'string', enum: ['reject', 'pro_rata'], description: 'Only `reject` is accepted. 06 requires pro_rata to come with a remainder rule and a tie-break, and neither is specified yet.' },
      requiresEligibility: { type: 'boolean' },
      requiresNda: { type: 'boolean' },
      closesAt: { type: ['string', 'null'], format: 'date-time' }
    }
  },
  Offering: {
    type: 'object',
    description: 'An offering as its issuer sees it. Carries no projected return, no valuation and no performance figure, because none of those would be a fact.',
    properties: {
      id: { type: 'string', format: 'uuid' },
      organizationId: { type: 'string', format: 'uuid' },
      slug: { type: 'string' },
      title: { type: 'string' },
      instrument: { type: 'string', enum: ['common_shares'] },
      currency: { type: 'string' },
      state: ref('OfferingState'),
      stateReason: { type: 'string' },
      sharesOffered: ref('ShareCount'),
      pricePerShareMinor: ref('MinorUnits'),
      maximumRaiseMinor: { ...ref('MinorUnits'), description: 'What a full raise would bring in: shares offered times the price.' },
      minimumRaiseMinor: ref('MinorUnits'),
      minimumTicketMinor: ref('MinorUnits'),
      maximumTicketMinor: { anyOf: [ref('MinorUnits'), { type: 'null' }] },
      useOfFunds: { type: 'string' },
      oversubscriptionPolicy: { type: 'string' },
      requiresEligibility: { type: 'boolean' },
      requiresNda: { type: 'boolean' },
      currentShares: ref('ShareCount'),
      postRaiseShares: { ...ref('ShareCount'), description: 'Shares in issue if every offered share sells.' },
      offeringPercentOfPostRaise: { ...ref('Percentage'), description: 'What the whole offering amounts to as a share of the company afterwards — never 100%.' },
      opensAt: { type: ['string', 'null'], format: 'date-time' },
      closesAt: { type: ['string', 'null'], format: 'date-time' },
      hasDisclosure: { type: 'boolean' },
      simulated: { type: 'boolean' },
      version: { type: 'integer' },
      createdAt: { type: 'string', format: 'date-time' }
    }
  },
  OfferingDisclosure: {
    type: 'object',
    description: 'Immutable and numbered. An investor accepts a specific version by its checksum, and a material revision creates a new version rather than editing this one.',
    properties: {
      id: { type: 'string', format: 'uuid' },
      sequence: { type: 'integer' },
      summary: { type: 'string' },
      risks: { type: 'string' },
      useOfFunds: { type: 'string' },
      checksum: { type: 'string', description: 'SHA-256 of the text, published so an acceptance can be checked against it by anyone.' },
      material: { type: 'boolean', description: 'A material revision halts an open offering until existing commitments are dealt with (06).' },
      reason: { type: 'string' },
      publishedAt: { type: 'string', format: 'date-time' }
    }
  },
  PublicOffering: {
    type: 'object',
    description: 'PUB-08. The public view. The data room’s own documents are not in this projection at all.',
    properties: {
      id: { type: 'string', format: 'uuid', description: 'On the detail projection only, never on a card. Every action an investor can take from this page is addressed by it.' },
      slug: { type: 'string' },
      title: { type: 'string' },
      instrument: { type: 'string' },
      currency: { type: 'string' },
      state: ref('OfferingState'),
      sharesOffered: ref('ShareCount'),
      pricePerShareMinor: ref('MinorUnits'),
      maximumRaiseMinor: ref('MinorUnits'),
      minimumRaiseMinor: ref('MinorUnits'),
      minimumTicketMinor: ref('MinorUnits'),
      maximumTicketMinor: { anyOf: [ref('MinorUnits'), { type: 'null' }] },
      offeringPercentOfPostRaise: ref('Percentage'),
      postRaiseShares: ref('ShareCount'),
      opensAt: { type: ['string', 'null'], format: 'date-time' },
      closesAt: { type: ['string', 'null'], format: 'date-time' },
      organization: { type: 'object', properties: { slug: { type: 'string' }, displayName: { type: 'string' }, city: { type: 'string' }, country: { type: 'string' }, verified: { type: 'boolean' } } },
      useOfFunds: { type: 'string' },
      disclosure: { anyOf: [ref('OfferingDisclosure'), { type: 'null' }] },
      publicDocuments: { type: 'array', items: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, title: { type: 'string' }, category: ref('DataRoomCategory') } } },
      requiresEligibility: { type: 'boolean' },
      requiresNda: { type: 'boolean' },
      acceptsCommitments: { type: 'boolean', description: 'Whether this offering will accept a commitment right now: the same condition the commitment endpoint enforces, so the page never offers a button the server would refuse.' },
      commitmentsUnavailableReason: { type: 'string', enum: ['', 'disclosure_revised', 'closing', 'round_ended', 'not_open', 'no_disclosure', 'closing_date_passed'], description: 'A machine code, empty when commitments are accepted. A code rather than a sentence, so the reason is rendered in the reader’s language.' },
      simulated: { type: 'boolean' }
    }
  },
  SubscriptionQuote: {
    type: 'object',
    description: 'What an amount would buy. Commits the reader to nothing, and is indicative until a final allocation (06).',
    properties: {
      currency: { type: 'string' },
      requestedMinor: { ...ref('MinorUnits'), description: 'What was asked for, before rounding down to whole shares.' },
      amountMinor: { ...ref('MinorUnits'), description: 'What whole shares actually cost, which may be less.' },
      remainderMinor: { ...ref('MinorUnits'), description: 'The part that buys no whole share. Reported rather than quietly kept.' },
      units: ref('ShareCount'),
      percentOfPostRaise: { ...ref('Percentage'), description: 'The honest figure: these shares over everything in issue after a full raise.' },
      percentOfOffering: { ...ref('Percentage'), description: 'Share of this offering alone. Much larger, and the number people mistake for the one above.' },
      postRaiseShares: ref('ShareCount'),
      belowMinimumTicket: { type: 'boolean' },
      aboveMaximumTicket: { type: 'boolean' },
      indicative: { type: 'boolean', const: true },
      simulated: { type: 'boolean' }
    }
  },
  InvestorEligibility: {
    type: 'object',
    description: 'PER-07. Eligibility is a reviewed decision with a reason and an expiry. Choosing the Investor capability is a separate fact, reported alongside precisely so the two are not confused.',
    properties: {
      state: ref('EligibilityState'),
      draft: { type: ['object', 'null'], additionalProperties: true },
      expiresAt: { type: ['string', 'null'], format: 'date-time' },
      reason: { type: 'string' },
      version: { type: 'integer' },
      capabilityChosen: { type: 'boolean', description: 'Whether the person selected the Investor capability. It grants nothing on its own.' },
      eligible: { type: 'boolean', description: 'The only field anything should act on: a current, approved, unexpired decision.' },
      submissions: { type: 'array', items: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, sequence: { type: 'integer' }, checksum: { type: 'string' }, submittedAt: { type: 'string', format: 'date-time' } } } },
      decisions: { type: 'array', items: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, outcome: ref('ReviewOutcome'), reason: { type: 'string' }, expiresAt: { type: ['string', 'null'], format: 'date-time' }, reviewer: { type: 'string' }, at: { type: 'string', format: 'date-time' } } } }
    }
  },
  EligibilityAnswers: {
    type: 'object',
    required: ['investorType', 'hasPriorExperience', 'acknowledgesTotalLossRisk', 'declaration'],
    additionalProperties: false,
    properties: {
      investorType: { type: 'string', enum: ['individual', 'institution'] },
      hasPriorExperience: { type: 'boolean' },
      acknowledgesTotalLossRisk: { type: 'boolean', description: 'Must be true to submit. 06 requires the total-loss acknowledgement to be explicit.' },
      declaration: { type: 'string', minLength: 20, maxLength: 2000 }
    }
  },
  DataRoom: {
    type: 'object',
    description: 'BUS-03 and PUB-08. Access is per offering: a grant on one gives nothing on another. Documents the reader may not open are counted, never listed.',
    properties: {
      offeringId: { type: 'string', format: 'uuid' },
      access: {
        type: 'object',
        properties: {
          level: { type: 'string', enum: ['public', 'nda', 'granted'] },
          hasLiveGrant: { type: 'boolean' },
          hasCurrentNda: { type: 'boolean', description: 'True only for an acceptance against the disclosure currently in force.' },
          ndaOutOfDate: { type: 'boolean', description: 'An older acceptance exists but the disclosure has been revised since; a fresh acknowledgement is needed.' },
          grantExpiresAt: { type: ['string', 'null'], format: 'date-time' },
          isIssuerStaff: { type: 'boolean' }
        }
      },
      requiresNda: { type: 'boolean' },
      documents: { type: 'array', items: ref('DataRoomDocument') },
      withheld: { type: 'integer', description: 'How many documents exist that this reader cannot open. Stated rather than hidden.' }
    }
  },
  DataRoomDocument: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      title: { type: 'string' },
      category: ref('DataRoomCategory'),
      classification: ref('DataRoomClassification'),
      checksum: { type: 'string' },
      byteSize: { type: 'integer' },
      contentType: { type: 'string' },
      sequence: { type: 'integer' },
      scanState: ref('ScanState'),
      downloadAvailable: { type: 'boolean', const: false, description: 'There is no document store yet, so a download link would be a control that cannot work.' },
      downloadUnavailableReason: { type: 'string' }
    }
  },
  NdaAcceptance: {
    type: 'object',
    description: 'What was agreed, and to which version. Publishing a revision never changes, invalidates or rewrites an existing acceptance.',
    properties: {
      id: { type: 'string', format: 'uuid' },
      disclosureId: { type: 'string', format: 'uuid' },
      sequence: { type: 'integer' },
      checksum: { type: 'string', description: 'Copied at acceptance time, so a later edit cannot change what this record claims was agreed.' },
      acceptedAt: { type: 'string', format: 'date-time' },
      disclosurePublishedAt: { type: 'string', format: 'date-time' }
    }
  },
  InvestorQuestion: {
    type: 'object',
    description: 'Private between one investor and the issuer. An investor sees only their own; 06 forbids a reply revealing other investors.',
    properties: {
      id: { type: 'string', format: 'uuid' },
      body: { type: 'string' },
      createdAt: { type: 'string', format: 'date-time' },
      answeredAt: { type: ['string', 'null'], format: 'date-time' },
      asker: { type: 'string', description: 'Present only for the issuer, who has to be able to answer them.' },
      replies: { type: 'array', items: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, body: { type: 'string' }, author: { type: 'string' }, at: { type: 'string', format: 'date-time' } } } }
    }
  },
  OfferingTermsCheck: {
    type: 'object',
    description: 'BUS-02.A02. Problems are returned as codes so the screens can name them in the reader’s language.',
    properties: {
      valid: { type: 'boolean' },
      ready: { type: 'boolean', description: 'Terms consistent **and** everything a reviewer needs is present.' },
      problems: { type: 'array', items: { type: 'object', properties: { code: { type: 'string' } } } },
      blockers: { type: 'array', items: { type: 'string' } },
      maximumRaiseMinor: ref('MinorUnits'),
      postRaiseShares: ref('ShareCount'),
      fullRaisePercent: ref('Percentage')
    }
  },

  // ---- PART-09: commitments, subscriptions, allocations and holdings ---------------------------
  // The distinction the whole part turns on is in these schemas: a Commitment is a reservation, a
  // Subscription is a contract, an Allocation is an issue, and only a Holding is a stake owned.
  // They are separate objects rather than states of one, so that no screen can quietly show one as
  // another.
  CommitmentState: {
    type: 'string',
    enum: ['reserved', 'confirmed', 'paying', 'paid', 'allocated', 'refunding', 'refunded', 'cancelled', 'expired', 'failed'],
    description: 'Where one investor has got to. `paid` means the money settled; it does not mean any share was issued — only `allocated` does.'
  },
  Commitment: {
    type: 'object',
    description: 'A reservation of capacity for a limited time. It is not a contract, not a payment and not a holding. `percentOfPostRaise` is present only on the reply that created it, and is marked indicative.',
    properties: {
      id: { type: 'string', format: 'uuid' },
      offeringId: { type: 'string', format: 'uuid' },
      requestedMinor: { ...ref('MinorUnits'), description: 'What the investor asked to put in.' },
      amountMinor: { ...ref('MinorUnits'), description: 'What that actually buys: a whole number of shares at the offering price.' },
      remainderMinor: { ...ref('MinorUnits'), description: 'The part of the request that bought no whole share. Reported rather than absorbed, because it is the investor’s money.' },
      units: ref('ShareCount'),
      currency: { type: 'string' },
      state: ref('CommitmentState'),
      disclosureId: { type: 'string', format: 'uuid', description: 'The disclosure version this commitment was made against. INV-03 compares it with the one in force.' },
      expiresAt: { type: 'string', format: 'date-time', description: 'After this the reservation stops holding capacity, with no job needing to run.' },
      cancelledReason: { type: 'string' },
      percentOfPostRaise: { ...ref('Percentage'), description: 'Only on creation, and only alongside `indicative: true`.' },
      indicative: { type: 'boolean', description: 'Present and true wherever a percentage is shown before allocation. 06 forbids presenting it as settled.' },
      simulated: { type: 'boolean' },
      version: { type: 'integer' },
      createdAt: { type: 'string', format: 'date-time' }
    }
  },
  Subscription: {
    type: 'object',
    description: 'The contract: this investor, these terms, this disclosure version. Append-only in SQL, so the text somebody agreed to can never be rewritten afterwards.',
    properties: {
      id: { type: 'string', format: 'uuid' },
      disclosureId: { type: 'string', format: 'uuid' },
      disclosureChecksum: { type: 'string', pattern: '^[0-9a-f]{64}$', description: 'Copied at the moment of agreement, so the contract names the exact text rather than pointing at a row that might change.' },
      contractChecksum: { type: 'string', pattern: '^[0-9a-f]{64}$' },
      signatureMethod: { type: 'string' },
      signatureIsSimulated: { type: 'boolean', description: 'Always true in this build. A click in a demo is not a signature, and the field says so rather than leaving a reader to assume.' },
      confirmedAt: { type: 'string', format: 'date-time' }
    }
  },
  OfferingCapacity: {
    type: 'object',
    description: 'What is left, and whether the offering would succeed if it closed now — stated before anyone commits, because their money may all come back.',
    properties: {
      sharesOffered: ref('ShareCount'),
      remainingUnits: { ...ref('ShareCount'), description: 'Excludes reservations that have lapsed, which stop holding capacity by themselves.' },
      committedUnits: ref('ShareCount'),
      committedMinor: ref('MinorUnits'),
      minimumRaiseMinor: ref('MinorUnits'),
      minimumReached: { type: 'boolean' },
      simulated: { type: 'boolean' }
    }
  },
  Holding: {
    type: 'object',
    description: 'A stake actually issued. Created only by a finalised allocation, never by an edit — a trigger refuses a hand-written change. It carries cost basis and distributions received, and no valuation, because there is no source for one.',
    properties: {
      id: { type: 'string', format: 'uuid' },
      venture: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, legalName: { type: 'string' }, organizationId: { type: 'string', format: 'uuid' } } },
      units: ref('ShareCount'),
      costMinor: { ...ref('MinorUnits'), description: 'What was paid. Not a current value, and never presented as one.' },
      distributionsReceivedMinor: { ...ref('MinorUnits'), description: 'Only distributions actually marked paid.' },
      currency: { type: 'string' },
      proofReference: { type: 'string', description: 'The allocation’s reference. In this build it is generated and marked simulated, because no database row created legal ownership.' },
      allocatedAt: { type: 'string', format: 'date-time' },
      simulated: { type: 'boolean' }
    }
  },
  Portfolio: {
    type: 'object',
    description: 'PER-06. Holdings and in-flight commitments kept in separate lists, so money committed can never be read as a stake owned. There is no market-value field anywhere in this object.',
    properties: {
      holdings: { type: 'array', items: ref('Holding') },
      inFlight: { type: 'array', items: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, offering: { type: 'object', properties: { slug: { type: 'string' }, title: { type: 'string' } } }, state: ref('CommitmentState'), amountMinor: ref('MinorUnits'), units: ref('ShareCount'), currency: { type: 'string' }, expiresAt: { type: 'string', format: 'date-time' } } } },
      valuationAvailable: { type: 'boolean', description: 'Always false. Stated rather than implied by an absent field.' },
      valuationUnavailableReason: { type: 'string' },
      simulated: { type: 'boolean' }
    }
  },
  AllocationSchedule: {
    type: 'object',
    description: 'Who would receive what, computed from settled money only. A checksum binds an approval to these exact figures; approving a different set is refused rather than applied.',
    properties: {
      offeringId: { type: 'string', format: 'uuid' },
      state: ref('OfferingState'),
      lines: { type: 'array', items: { type: 'object', properties: { commitmentId: { type: 'string', format: 'uuid' }, userId: { type: 'string', format: 'uuid' }, units: ref('ShareCount'), costMinor: ref('MinorUnits'), percentOfPostRaise: ref('Percentage') } } },
      totalUnits: ref('ShareCount'),
      totalMinor: ref('MinorUnits'),
      checksum: { type: 'string', pattern: '^[0-9a-f]{64}$' },
      minimumRaiseMinor: ref('MinorUnits'),
      minimumReached: { type: 'boolean', description: 'The question INV-04 turns on, answered before anyone commits to a decision.' },
      paidButUnsettled: { type: 'integer', description: 'Money that arrived but has not settled, and so cannot be allocated. Counted rather than silently excluded.' },
      simulated: { type: 'boolean' }
    }
  },
  ClosingReadiness: {
    type: 'object',
    description: 'INV-04. What still stands between a failed offering and being closed. Both conditions are reported separately so a screen can say which one is not met.',
    properties: {
      state: ref('OfferingState'),
      outstandingCommitments: { type: 'integer' },
      refundedCommitments: { type: 'integer' },
      escrowRestrictedMinor: { anyOf: [ref('MinorUnits'), { type: 'null' }], description: 'Money the escrow still holds. Non-zero means it has not finished returning it, whatever the states say.' },
      canClose: { type: 'boolean' }
    }
  },
  Distribution: {
    type: 'object',
    description: 'BUS-05. Each line is `total × units / totalUnits`, truncated, so no line rounds up beyond what the pot holds. Whatever will not divide evenly is declared as a remainder rather than handed to somebody arbitrarily.',
    properties: {
      id: { type: 'string', format: 'uuid' },
      state: { type: 'string', enum: ['requested', 'approved', 'paid', 'rejected'] },
      totalMinor: ref('MinorUnits'),
      currency: { type: 'string' },
      reason: { type: 'string' },
      snapshotUnits: { ...ref('ShareCount'), description: 'The register as it stood when the lines were computed. An approval is refused if it has moved since.' },
      lines: { type: 'integer' },
      undistributedRemainderMinor: ref('MinorUnits'),
      simulated: { type: 'boolean' },
      note: { type: 'string', description: 'On payment: `no_investor_payout_rail`. The record moved; the money did not, and this says so.' },
      version: { type: 'integer' }
    }
  },
  InvestorRelations: {
    type: 'object',
    description: 'PER-09. What one investor may read about a company they hold in: the company’s reports, their own distribution lines and the recorded events. Another holder’s amounts are absent.',
    properties: {
      units: ref('ShareCount'),
      reports: { type: 'array', items: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, sequence: { type: 'integer' }, title: { type: 'string' }, body: { type: 'string' }, periodStart: { type: 'string', format: 'date-time' }, periodEnd: { type: 'string', format: 'date-time' }, publishedAt: { type: 'string', format: 'date-time' } } } },
      distributions: { type: 'array', items: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, distributionId: { type: 'string', format: 'uuid' }, state: { type: 'string' }, reason: { type: 'string' }, amountMinor: ref('MinorUnits'), currency: { type: 'string' }, approvedAt: { type: ['string', 'null'], format: 'date-time' } } } },
      events: { type: 'array', items: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, kind: { type: 'string', enum: ['report', 'distribution', 'buyback', 'exit', 'loss', 'liquidation'] }, title: { type: 'string' }, body: { type: 'string' }, effectiveAt: { type: 'string', format: 'date-time' } } } },
      simulated: { type: 'boolean' }
    }
  },

  // ---- PART-10: programmes, cohorts, applications, enrolment and training -----------------------
  // Four separate things, and the schemas keep them apart: a Program is the plan, a Cohort is a
  // group with seats and dates, an Application is a candidacy, an Enrolment is a seat accepted. A
  // job is none of them, and no field here implies one.
  ProgramState: { type: 'string', enum: ['draft', 'review', 'approved', 'recruiting', 'selection', 'active', 'completed', 'follow_up', 'closed', 'paused', 'cancelled'] },
  ApplicationState: { type: 'string', enum: ['draft', 'submitted', 'screening', 'shortlisted', 'interview', 'accepted', 'waitlisted', 'rejected', 'withdrawn', 'discarded'] },
  EnrollmentState: { type: 'string', enum: ['invited', 'confirmed', 'active', 'completed', 'dropped_out', 'terminated', 'expired'] },
  AttendanceStatus: { type: 'string', enum: ['present', 'absent', 'excused', 'late'] },
  DeliveryMode: { type: 'string', enum: ['in_person', 'remote', 'hybrid'] },
  JobCommitmentKind: {
    type: 'string',
    enum: ['none', 'expected', 'committed'],
    description: '07 forbids an unqualified claim about jobs. `expected` is a target the operator hopes for; `committed` is an obligation it has signed up to and must carry its terms. A count is never returned without this.'
  },

  ProgramInput: {
    type: 'object',
    required: ['title', 'summary', 'capacity'],
    additionalProperties: false,
    properties: {
      title: { type: 'string', minLength: 4, maxLength: 200 },
      summary: { type: 'string', minLength: 20, maxLength: 2000 },
      skills: { type: 'array', maxItems: 30, items: { type: 'string', maxLength: 60 } },
      level: { type: 'string', maxLength: 60 },
      deliveryMode: ref('DeliveryMode'),
      city: { type: 'string', maxLength: 100 },
      capacity: { type: 'integer', minimum: 1, maximum: 100000 },
      applyOpensAt: { type: ['string', 'null'], format: 'date-time' },
      applyClosesAt: { type: ['string', 'null'], format: 'date-time' },
      durationWeeks: { type: 'integer', minimum: 0, maximum: 520 },
      hoursPerWeek: { type: 'integer', minimum: 0, maximum: 80 },
      schedule: { type: 'string', maxLength: 1000 },
      attendancePolicy: { type: 'string', maxLength: 2000, description: 'Required before publishing. A stipend or a completion rule that depends on attendance cannot be fair if the rule appears afterwards.' },
      assessmentPolicy: { type: 'string', maxLength: 2000 },
      selectionMethod: { type: 'string', maxLength: 2000 },
      withdrawalPolicy: { type: 'string', maxLength: 2000 },
      accessibilityNote: { type: 'string', maxLength: 1000 },
      privacyNote: { type: 'string', maxLength: 1000 },
      complaintsContact: { type: 'string', maxLength: 200 },
      stipendOffered: { type: 'boolean' },
      stipendAmountMinor: { anyOf: [ref('MinorUnits'), { type: 'null' }] },
      stipendCurrency: { type: ['string', 'null'], pattern: '^[A-Za-z]{3}$' },
      stipendConditions: { type: 'string', maxLength: 1000 },
      jobCommitmentKind: ref('JobCommitmentKind'),
      jobCount: { type: 'integer', minimum: 0, maximum: 100000, description: 'Refused unless the kind qualifies it, and vice versa: a bare number is exactly the ambiguity 07 forbids.' },
      jobCommitmentTerms: { type: 'string', maxLength: 2000, description: 'At least 20 characters when the kind is `committed`, because a promise has to say what it promises.' },
      minimumAge: { type: ['integer', 'null'], minimum: 14, maximum: 100 },
      maximumAge: { type: ['integer', 'null'], minimum: 14, maximum: 100 },
      educationRequirement: { type: 'string', maxLength: 500 }
    }
  },
  Program: {
    type: 'object',
    description: 'The operator’s own view of a programme. Every mandatory disclosure in 07 is a field rather than free text, so no screen can quietly omit one.',
    properties: {
      id: { type: 'string', format: 'uuid' },
      organizationId: { type: 'string', format: 'uuid' },
      slug: { type: 'string' },
      title: { type: 'string' },
      summary: { type: 'string' },
      skills: { type: 'array', items: { type: 'string' } },
      level: { type: 'string' },
      deliveryMode: ref('DeliveryMode'),
      city: { type: 'string' },
      capacity: { type: 'integer' },
      applyOpensAt: { type: ['string', 'null'], format: 'date-time' },
      applyClosesAt: { type: ['string', 'null'], format: 'date-time' },
      durationWeeks: { type: 'integer' },
      hoursPerWeek: { type: 'integer' },
      schedule: { type: 'string' },
      attendancePolicy: { type: 'string' },
      assessmentPolicy: { type: 'string' },
      selectionMethod: { type: 'string' },
      withdrawalPolicy: { type: 'string' },
      accessibilityNote: { type: 'string' },
      privacyNote: { type: 'string' },
      complaintsContact: { type: 'string' },
      jobCommitmentKind: ref('JobCommitmentKind'),
      jobCount: { type: 'integer' },
      jobCommitmentTerms: { type: 'string' },
      completionGuaranteesJob: { type: 'boolean', const: false, description: '07’s stage limit, stated rather than left to be inferred: completing training entitles nobody to a job.' },
      stipendOffered: { type: 'boolean' },
      stipendAmountMinor: { anyOf: [ref('MinorUnits'), { type: 'null' }] },
      stipendCurrency: { type: ['string', 'null'] },
      stipendConditions: { type: 'string' },
      stipendPayable: { type: 'boolean', const: false, description: 'Always false in this build: a stipend is declared so a candidate can read it before applying, and paying one is PART-12.' },
      stipendUnavailableReason: { type: 'string' },
      minimumAge: { type: ['integer', 'null'] },
      maximumAge: { type: ['integer', 'null'] },
      educationRequirement: { type: 'string' },
      state: ref('ProgramState'),
      stateReason: { type: 'string' },
      publishedAt: { type: ['string', 'null'], format: 'date-time' },
      version: { type: 'integer' },
      createdAt: { type: 'string', format: 'date-time' }
    }
  },
  Cohort: {
    type: 'object',
    description: 'A group with its own seats and dates. Seats live here rather than on the programme, because two cohorts of one programme fill independently.',
    properties: {
      id: { type: 'string', format: 'uuid' },
      programId: { type: 'string', format: 'uuid' },
      name: { type: 'string' },
      capacity: { type: 'integer' },
      seatsTaken: { type: 'integer', description: 'Seats actually held: confirmed members plus invitations that have not lapsed. An expired invitation holds nothing.' },
      seatsRemaining: { type: 'integer' },
      startAt: { type: 'string', format: 'date-time' },
      endAt: { type: 'string', format: 'date-time' },
      acceptanceWindowHours: { type: 'integer', description: 'How long an invited candidate has to accept before the seat returns to the waitlist.' },
      timezone: { type: 'string', description: 'Carried with every date in this part. A time without its zone is a time somebody misses.' },
      state: { type: 'string', enum: ['planned', 'recruiting', 'running', 'completed', 'cancelled'] },
      version: { type: 'integer' }
    }
  },
  ProgramReadiness: {
    type: 'object',
    description: 'What a reviewer would refuse, named field by field so the operator knows what to fix rather than being told only that it failed.',
    properties: {
      valid: { type: 'boolean' },
      ready: { type: 'boolean' },
      problems: { type: 'array', items: { type: 'object', properties: { code: { type: 'string' } } } },
      blockers: { type: 'array', items: { type: 'string' } },
      cohortSeats: { type: 'string' },
      capacity: { type: 'string' }
    }
  },
  PublicProgram: {
    type: 'object',
    description: 'PUB-09/PUB-10. Built field by field. Nothing about the operator’s internal plan, and no candidate’s data, crosses into it.',
    properties: {
      slug: { type: 'string' },
      title: { type: 'string' },
      skills: { type: 'array', items: { type: 'string' } },
      level: { type: 'string' },
      deliveryMode: ref('DeliveryMode'),
      city: { type: 'string' },
      capacity: { type: 'integer' },
      durationWeeks: { type: 'integer' },
      hoursPerWeek: { type: 'integer' },
      applyOpensAt: { type: ['string', 'null'], format: 'date-time' },
      applyClosesAt: { type: ['string', 'null'], format: 'date-time' },
      state: ref('ProgramState'),
      jobCommitmentKind: ref('JobCommitmentKind'),
      jobCount: { type: 'integer' },
      jobCommitmentTerms: { type: 'string' },
      completionGuaranteesJob: { type: 'boolean', const: false },
      stipendOffered: { type: 'boolean' },
      stipendPayable: { type: 'boolean', const: false },
      organization: { type: 'object', properties: { slug: { type: 'string' }, displayName: { type: 'string' }, city: { type: 'string' }, country: { type: 'string' }, verified: { type: 'boolean' } } },
      summary: { type: 'string' },
      attendancePolicy: { type: 'string' },
      assessmentPolicy: { type: 'string' },
      selectionMethod: { type: 'string' },
      withdrawalPolicy: { type: 'string' },
      accessibilityNote: { type: 'string' },
      privacyNote: { type: 'string' },
      complaintsContact: { type: 'string' },
      cohorts: { type: 'array', items: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string' }, startAt: { type: 'string', format: 'date-time' }, endAt: { type: 'string', format: 'date-time' }, timezone: { type: 'string' }, capacity: { type: 'integer' }, seatsTaken: { type: 'integer' }, seatsRemaining: { type: 'integer' } } } },
      acceptsApplications: { type: 'boolean', description: 'The same condition the submit endpoint enforces, so the page never offers a button the server would refuse.' },
      applicationsUnavailableReason: { type: 'string', enum: ['', 'paused', 'selection_in_progress', 'programme_started', 'not_open', 'not_open_yet', 'deadline_passed'], description: 'A machine code, empty when an application would be accepted, so the reason is rendered in the reader’s language.' }
    }
  },
  CandidateProfile: {
    type: 'object',
    description: 'PER-10. What a candidate chooses to show. Consent is off by default and revocable, and revoking it takes the profile back from every operator at once.',
    properties: {
      exists: { type: 'boolean', description: 'False where the person has never filled it in, which is not the same as filling it in blank.' },
      headline: { type: 'string' },
      summary: { type: 'string' },
      city: { type: 'string' },
      availability: { type: 'string' },
      education: { type: 'string' },
      experience: { type: 'string' },
      skills: { type: 'array', items: { type: 'string' } },
      cvReference: { type: 'string', description: 'A name the candidate typed. The document store is PART-13, so nothing is uploaded here.' },
      cvUploadAvailable: { type: 'boolean', const: false },
      shareWithOperators: { type: 'boolean' },
      shareContact: { type: 'boolean', description: 'A second, narrower decision. It cannot be true while the profile itself is not shared.' },
      version: { type: 'integer' }
    }
  },
  SharedCandidateProfile: {
    type: 'object',
    description: 'The allowlist an operator actually receives, produced by the same function the candidate’s own preview uses so the two cannot drift apart.',
    properties: {
      name: { type: 'string' },
      headline: { type: 'string' },
      summary: { type: 'string' },
      city: { type: 'string' },
      availability: { type: 'string' },
      education: { type: 'string' },
      experience: { type: 'string' },
      skills: { type: 'array', items: { type: 'string' } },
      cvReference: { type: 'string' },
      email: { type: ['string', 'null'], description: 'Present only under the separate contact consent; absent rather than blank when withheld.' }
    }
  },
  Application: {
    type: 'object',
    description: 'A candidacy for one cohort. One per person per cohort, enforced by a unique index rather than by a check somebody could forget.',
    properties: {
      id: { type: 'string', format: 'uuid' },
      programId: { type: 'string', format: 'uuid' },
      cohortId: { type: 'string', format: 'uuid' },
      reference: { type: 'string', description: 'Short and quotable, and deliberately not the database identifier.' },
      state: ref('ApplicationState'),
      motivation: { type: 'string' },
      sharingConsent: { type: 'boolean' },
      submittedAt: { type: ['string', 'null'], format: 'date-time' },
      decidedAt: { type: ['string', 'null'], format: 'date-time' },
      withdrawnReason: { type: 'string' },
      version: { type: 'integer' },
      createdAt: { type: 'string', format: 'date-time' },
      trainingIsNotEmployment: { type: 'boolean', const: true, description: '07’s stage limit, repeated on every application because it is the thing people most often assume wrongly.' }
    }
  },
  Interview: {
    type: 'object',
    description: 'An appointment, with the zone it was agreed in. A reschedule is a request; the time does not move until somebody acts on it.',
    properties: {
      id: { type: 'string', format: 'uuid' },
      scheduledAt: { type: 'string', format: 'date-time' },
      durationMinutes: { type: 'integer' },
      timezone: { type: 'string' },
      mode: ref('DeliveryMode'),
      location: { type: 'string', description: 'Required unless the appointment is remote.' },
      state: { type: 'string', enum: ['proposed', 'confirmed', 'reschedule_requested', 'completed', 'cancelled'] },
      confirmedAt: { type: ['string', 'null'], format: 'date-time' },
      version: { type: 'integer' }
    }
  },
  Enrollment: {
    type: 'object',
    description: 'A seat. Created `invited` by a decision, and confirmed only when the person accepts within the window; letting it lapse returns the seat to the waitlist with no job having to run.',
    properties: {
      id: { type: 'string', format: 'uuid' },
      cohortId: { type: 'string', format: 'uuid' },
      applicationId: { type: 'string', format: 'uuid' },
      state: ref('EnrollmentState'),
      invitedAt: { type: 'string', format: 'date-time' },
      invitationExpiresAt: { type: 'string', format: 'date-time' },
      confirmedAt: { type: ['string', 'null'], format: 'date-time' },
      exitReason: { type: 'string' },
      version: { type: 'integer' },
      acceptable: { type: 'boolean', description: 'True only while the seat can still be taken, so a screen never offers a dead button.' },
      trainingIsNotEmployment: { type: 'boolean', const: true }
    }
  },
  CohortCapacity: {
    type: 'object',
    properties: {
      cohortId: { type: 'string', format: 'uuid' },
      capacity: { type: 'integer' },
      seatsTaken: { type: 'integer' },
      seatsRemaining: { type: 'integer' },
      waitlistLength: { type: 'integer' }
    }
  },
  TrainingSession: {
    type: 'object',
    description: 'One meeting of a cohort. `closed` is what makes a later attendance change a revision rather than an edit.',
    properties: {
      id: { type: 'string', format: 'uuid' },
      cohortId: { type: 'string', format: 'uuid' },
      title: { type: 'string' },
      startsAt: { type: 'string', format: 'date-time' },
      endsAt: { type: 'string', format: 'date-time' },
      timezone: { type: 'string' },
      mode: ref('DeliveryMode'),
      location: { type: 'string' },
      state: { type: 'string', enum: ['scheduled', 'held', 'cancelled', 'closed'] },
      closedAt: { type: ['string', 'null'], format: 'date-time' },
      version: { type: 'integer' }
    }
  },
  AttendanceRegister: {
    type: 'object',
    description: 'PRG-05. Every confirmed member, recorded or not, so an unmarked trainee is visibly unmarked rather than absent from the list.',
    properties: {
      session: ref('TrainingSession'),
      cohort: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string' }, timezone: { type: 'string' } } },
      canCorrect: { type: 'boolean' },
      canReviewObjections: { type: 'boolean', description: 'False for a trainer: whoever records does not rule on a dispute about their own record.' },
      rows: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            enrollmentId: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            status: { anyOf: [ref('AttendanceStatus'), { type: 'null' }] },
            excuseNote: { type: 'string' },
            attendanceId: { type: ['string', 'null'], format: 'uuid' },
            version: { type: ['integer', 'null'] },
            revisions: { type: 'array', items: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, from: ref('AttendanceStatus'), to: ref('AttendanceStatus'), reason: { type: 'string' }, afterClose: { type: 'boolean' }, at: { type: 'string', format: 'date-time' } } } },
            openObjection: { type: ['string', 'null'], format: 'uuid' }
          }
        }
      }
    }
  },
  MyTraining: {
    type: 'object',
    description: 'PER-13. The trainee’s own record: the schedule, their attendance, what it adds up to, and the rule it will be read against, quoted next to it.',
    properties: {
      enrollment: { type: 'object', additionalProperties: true },
      cohort: { type: 'object', additionalProperties: true },
      program: { type: 'object', additionalProperties: true },
      sessions: { type: 'array', items: { type: 'object', additionalProperties: true } },
      attendanceSummary: {
        type: 'object',
        properties: {
          recorded: { type: 'integer' }, counted: { type: 'integer' }, present: { type: 'integer' },
          late: { type: 'integer' }, excused: { type: 'integer' }, absent: { type: 'integer' },
          policy: { type: 'string', description: 'The programme’s published attendance rule, returned with the counts rather than left on another page.' }
        }
      },
      results: { type: 'array', items: { type: 'object', additionalProperties: true } },
      withdrawalRequests: { type: 'array', items: { type: 'object', additionalProperties: true } },
      stipends: { type: 'object', properties: { available: { type: 'boolean', const: false }, reason: { type: 'string' }, offeredByProgram: { type: 'boolean' }, conditions: { type: 'string' } }, description: 'PART-12 owns paying a stipend. Declared here so the screen states the absence instead of rendering an empty section.' },
      certificate: { type: 'object', properties: { available: { type: 'boolean', const: false }, reason: { type: 'string' } } }
    }
  }
,
  // ---- PART-11: jobs, offers, placements --------------------------------------------------------
  ContractType: { type: 'string', enum: ['full_time', 'part_time', 'fixed_term', 'apprenticeship', 'temporary'] },
  JobState: { type: 'string', enum: ['draft', 'review', 'open', 'paused', 'closed', 'filled', 'cancelled'] },
  JobApplicationState: { type: 'string', enum: ['draft', 'submitted', 'screening', 'shortlisted', 'interview', 'offered', 'hired', 'rejected', 'withdrawn'] },
  JobOfferState: { type: 'string', enum: ['draft', 'sent', 'accepted', 'declined', 'withdrawn', 'expired'] },
  PlacementState: {
    type: 'string',
    enum: ['offered', 'accepted', 'start_pending', 'started', 'retained', 'ended', 'disputed'],
    description: 'JOB-01 is the distance between `start_pending` and `started`: the first is somebody having said yes, the second is somebody having confirmed they turned up. A CHECK constraint refuses `started` without an actual, verified start date.'
  },
  FollowupResult: {
    type: 'string',
    enum: ['working', 'ended', 'unknown', 'disputed'],
    description: 'JOB-02. `unknown` is a first-class answer, not a gap: a checkpoint nobody replied to is reported as its own figure rather than folded into either success or failure.'
  },
  /** Pay stated, or its absence explained. Never simply absent. */
  JobSalary: {
    type: 'object',
    description: '07: a listing that says nothing about pay leaves the reader guessing. Either the figures are here, or `salaryUndisclosedReason` says why they are not — a CHECK constraint enforces one or the other.',
    properties: {
      salaryDisclosed: { type: 'boolean' },
      salaryMinMinor: { oneOf: [ref('MinorUnits'), { type: 'null' }] },
      salaryMaxMinor: { oneOf: [ref('MinorUnits'), { type: 'null' }] },
      salaryCurrency: { type: ['string', 'null'], minLength: 3, maxLength: 3 },
      salaryPeriod: { type: 'string' },
      salaryUndisclosedReason: { type: 'string' }
    }
  },
  JobInput: {
    type: 'object',
    required: ['title', 'summary'],
    additionalProperties: false,
    properties: {
      title: { type: 'string', minLength: 4, maxLength: 200 },
      summary: { type: 'string', minLength: 20, maxLength: 2000 },
      responsibilities: { type: 'string', maxLength: 4000 },
      requirements: { type: 'string', maxLength: 4000 },
      skills: { type: 'array', maxItems: 30, items: { type: 'string', maxLength: 60 } },
      contractType: ref('ContractType'),
      contractMonths: { type: ['integer', 'null'], minimum: 1, maximum: 120, description: 'Required for a fixed term: a fixed term that does not say how long is not a stated contract type.' },
      deliveryMode: ref('DeliveryMode'),
      city: { type: 'string', maxLength: 100 },
      hoursPerWeek: { type: 'integer', minimum: 0, maximum: 80 },
      salaryDisclosed: { type: 'boolean' },
      salaryMinMinor: { type: ['string', 'null'], pattern: '^[0-9]{1,16}$' },
      salaryMaxMinor: { type: ['string', 'null'], pattern: '^[0-9]{1,16}$' },
      salaryCurrency: { type: ['string', 'null'], pattern: '^[A-Za-z]{3}$' },
      salaryPeriod: { type: 'string', maxLength: 20 },
      salaryUndisclosedReason: { type: 'string', maxLength: 200, description: 'At least ten characters when pay is not disclosed.' },
      closesAt: { type: ['string', 'null'], format: 'date-time' },
      openings: { type: 'integer', minimum: 1, maximum: 10000 },
      programId: { type: ['string', 'null'], format: 'uuid', description: 'The programme this job came out of, where there is one. A programme never creates a job.' }
    }
  },
  Job: {
    type: 'object',
    description: 'A job as its employer sees it, drafts included.',
    properties: {
      id: { type: 'string', format: 'uuid' },
      organizationId: { type: 'string', format: 'uuid' },
      programId: { type: ['string', 'null'], format: 'uuid' },
      slug: { type: 'string' },
      title: { type: 'string' },
      summary: { type: 'string' },
      responsibilities: { type: 'string' },
      requirements: { type: 'string' },
      skills: { type: 'array', items: { type: 'string' } },
      contractType: ref('ContractType'),
      contractMonths: { type: ['integer', 'null'] },
      deliveryMode: ref('DeliveryMode'),
      city: { type: 'string' },
      hoursPerWeek: { type: 'integer' },
      salaryDisclosed: { type: 'boolean' },
      salaryMinMinor: { type: ['string', 'null'] },
      salaryMaxMinor: { type: ['string', 'null'] },
      salaryCurrency: { type: ['string', 'null'] },
      salaryPeriod: { type: 'string' },
      salaryUndisclosedReason: { type: 'string' },
      closesAt: { type: ['string', 'null'], format: 'date-time' },
      openings: { type: 'integer' },
      state: ref('JobState'),
      stateReason: { type: 'string' },
      publishedAt: { type: ['string', 'null'], format: 'date-time' },
      version: { type: 'integer' },
      createdAt: { type: 'string', format: 'date-time' }
    }
  },
  JobReadiness: {
    type: 'object',
    description: 'What a publish would refuse, named field by field so the operator knows what to fix rather than being told only that it failed.',
    properties: {
      valid: { type: 'boolean' },
      ready: { type: 'boolean' },
      problems: { type: 'array', items: { type: 'object', properties: { code: { type: 'string' } } } },
      blockers: { type: 'array', items: { type: 'string' } }
    }
  },
  PublicJob: {
    type: 'object',
    description: 'PUB-09/PUB-11. Built field by field. No candidate data of any kind crosses into it, and it states whether applications are open and why not when they are closed.',
    properties: {
      slug: { type: 'string' },
      title: { type: 'string' },
      summary: { type: 'string' },
      responsibilities: { type: 'string' },
      requirements: { type: 'string' },
      skills: { type: 'array', items: { type: 'string' } },
      contractType: ref('ContractType'),
      contractMonths: { type: ['integer', 'null'] },
      deliveryMode: ref('DeliveryMode'),
      city: { type: 'string' },
      hoursPerWeek: { type: 'integer' },
      openings: { type: 'integer' },
      closesAt: { type: ['string', 'null'], format: 'date-time' },
      state: ref('JobState'),
      salaryDisclosed: { type: 'boolean' },
      salaryMinMinor: { type: ['string', 'null'] },
      salaryMaxMinor: { type: ['string', 'null'] },
      salaryCurrency: { type: ['string', 'null'] },
      salaryPeriod: { type: 'string' },
      salaryUndisclosedReason: { type: 'string' },
      organization: { type: 'object', properties: { slug: { type: 'string' }, displayName: { type: 'string' }, city: { type: 'string' }, country: { type: 'string' }, verified: { type: 'boolean' } } },
      program: { type: ['object', 'null'], additionalProperties: true, description: 'The training this job came out of, where there is one.' },
      programDidNotPromiseThisJob: { type: 'boolean', const: true, description: '07’s stage limit. A job linked to a programme is still not something that programme promised anybody.' },
      acceptsApplications: { type: 'boolean' },
      applicationsUnavailableReason: { type: 'string', enum: ['', 'paused', 'filled', 'not_open', 'deadline_passed'] }
    }
  },
  JobApplication: {
    type: 'object',
    description: 'A candidacy for a job. Its own record with its own states: 07 keeps it separate from a training application, because being accepted onto training is not being accepted for work.',
    properties: {
      id: { type: 'string', format: 'uuid' },
      jobId: { type: 'string', format: 'uuid' },
      reference: { type: 'string', description: 'Short and quotable, and deliberately not the database identifier.' },
      state: ref('JobApplicationState'),
      sharingConsent: { type: 'boolean' },
      submittedAt: { type: ['string', 'null'], format: 'date-time' },
      decidedAt: { type: ['string', 'null'], format: 'date-time' },
      withdrawnReason: { type: 'string' },
      version: { type: 'integer' },
      createdAt: { type: 'string', format: 'date-time' },
      kind: { type: 'string', const: 'job' }
    }
  },
  EmployerJobApplication: {
    type: 'object',
    description: 'A candidacy as the employer receives it. The candidate block is present only while consent on this application and profile sharing both stand; otherwise it is null and the row names which one is missing.',
    properties: {
      id: { type: 'string', format: 'uuid' },
      reference: { type: 'string' },
      state: ref('JobApplicationState'),
      job: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, title: { type: 'string' } } },
      submittedAt: { type: ['string', 'null'], format: 'date-time' },
      version: { type: 'integer' },
      candidate: { oneOf: [ref('SharedCandidateProfile'), { type: 'null' }] },
      profileShared: { type: 'boolean' },
      profileWithheldReason: { type: 'string', enum: ['', 'no_consent', 'consent_revoked'] },
      viaReferral: { type: 'boolean' },
      nextInterview: { type: ['object', 'null'], additionalProperties: true },
      latestOffer: { type: ['object', 'null'], additionalProperties: true }
    }
  },
  JobOfferInput: {
    type: 'object',
    required: ['jobApplicationId', 'title', 'terms', 'proposedStartDate', 'respondByAt'],
    additionalProperties: false,
    properties: {
      jobApplicationId: { type: 'string', format: 'uuid' },
      title: { type: 'string', minLength: 4, maxLength: 200 },
      terms: { type: 'string', minLength: 20, maxLength: 4000, description: 'What the candidate is agreeing to. A one-line offer is refused.' },
      contractType: ref('ContractType'),
      contractMonths: { type: ['integer', 'null'], minimum: 1, maximum: 120 },
      salaryMinor: { type: ['string', 'null'], pattern: '^[0-9]{1,16}$' },
      salaryCurrency: { type: ['string', 'null'], pattern: '^[A-Za-z]{3}$' },
      salaryPeriod: { type: 'string', maxLength: 20 },
      proposedStartDate: { type: 'string', format: 'date', description: 'What the employer proposes. The actual start is a separate, confirmed fact.' },
      respondByAt: { type: 'string', format: 'date-time', description: 'Must be in the future and not after the proposed start: a deadline past the first day answers nothing.' }
    }
  },
  JobOffer: {
    type: 'object',
    description: 'A versioned offer, frozen by a trigger once sent. A change is a new offer with its own sequence and its own checksum, so the candidate always knows which text they said yes to.',
    properties: {
      id: { type: 'string', format: 'uuid' },
      jobApplicationId: { type: 'string', format: 'uuid' },
      sequence: { type: 'integer', description: '1 for the first offer on this application, 2 for the next.' },
      state: ref('JobOfferState'),
      title: { type: 'string' },
      terms: { type: 'string' },
      contractType: ref('ContractType'),
      contractMonths: { type: ['integer', 'null'] },
      salaryMinor: { type: ['string', 'null'] },
      salaryCurrency: { type: ['string', 'null'] },
      salaryPeriod: { type: 'string' },
      proposedStartDate: { type: 'string', format: 'date' },
      respondByAt: { type: 'string', format: 'date-time' },
      termsChecksum: { type: 'string', pattern: '^[0-9a-f]{64}$', description: 'SHA-256 over the terms as sent. Acceptance must quote it, so a changed offer cannot be accepted.' },
      sentAt: { type: ['string', 'null'], format: 'date-time' },
      respondedAt: { type: ['string', 'null'], format: 'date-time' },
      declineReason: { type: 'string' },
      withdrawReason: { type: 'string' },
      version: { type: 'integer' },
      createdAt: { type: 'string', format: 'date-time' }
    }
  },
  Placement: {
    type: 'object',
    description: 'The employment itself. Created at `start_pending` when an offer is accepted, and never at `started`: JOB-01 is precisely that saying yes and turning up are different events.',
    properties: {
      id: { type: 'string', format: 'uuid' },
      jobId: { type: 'string', format: 'uuid' },
      offerId: { type: 'string', format: 'uuid' },
      state: ref('PlacementState'),
      proposedStartDate: { type: 'string', format: 'date', description: 'What the offer said. Kept beside the actual date so the two can never be confused.' },
      actualStartDate: { type: ['string', 'null'], format: 'date', description: 'Set only on a confirmed start. Every follow-up is counted from this date.' },
      startVerifiedAt: { type: ['string', 'null'], format: 'date-time' },
      endedAt: { type: ['string', 'null'], format: 'date-time' },
      endReason: { type: 'string' },
      disputeReason: { type: 'string' },
      selfFound: { type: 'boolean', description: '14: work the person found themselves, reported separately and never added to the programme’s figure.' },
      version: { type: 'integer' },
      createdAt: { type: 'string', format: 'date-time' },
      startConfirmed: { type: 'boolean' },
      countsAsEmployment: { type: 'boolean', description: 'True only for `started` and `retained`. An accepted offer is not employment.' }
    }
  },
  PlacementSummary: {
    type: 'object',
    description: 'PRG-09.A04. Counts, with the denominator named rather than implied. No names, no contact details: 12 keeps beneficiary data out of any exported projection.',
    properties: {
      generatedAt: { type: 'string', format: 'date-time' },
      offersAccepted: { type: 'integer' },
      startsConfirmed: { type: 'integer', description: 'JOB-01: confirmed starts only. Accepted offers are not in this figure.' },
      startsPending: { type: 'integer' },
      ended: { type: 'integer' },
      disputed: { type: 'integer' },
      selfFound: { type: 'integer' },
      retention: {
        type: 'object',
        properties: {
          denominator: { type: 'integer' },
          denominatorDefinition: { type: 'string', enum: ['ninety_days_since_confirmed_start'], description: 'A code the caller renders in its own language. Prose here would put one language’s sentence on every screen.' },
          answered: { type: 'integer' },
          working: { type: 'integer' },
          unknown: { type: 'integer', description: 'JOB-02: the checkpoints nobody answered, reported rather than absorbed into either column.' }
        }
      },
      redacted: { type: 'boolean', const: true },
      containsPersonalData: { type: 'boolean', const: false }
    }
  }
,
  // ---- PART-12: agreements, stipends, certificates, incubation, assistance, volunteering --------
  AgreementKind: { type: 'string', enum: ['cash', 'in_kind', 'mixed'], description: '08 reports cash and in-kind separately and never adds them together.' },
  AgreementState: { type: 'string', enum: ['draft', 'pending_acceptance', 'active', 'completed', 'terminated', 'disputed'] },
  AgreementInput: {
    type: 'object',
    required: ['operatorOrgId', 'title', 'purpose'],
    additionalProperties: false,
    properties: {
      operatorOrgId: { type: 'string', format: 'uuid', description: 'The other party. An agreement with itself is refused by a CHECK constraint.' },
      title: { type: 'string', minLength: 4, maxLength: 200 },
      kind: ref('AgreementKind'),
      amountMinor: { type: ['string', 'null'], pattern: '^[0-9]{1,16}$', description: 'Required for a cash or mixed agreement.' },
      currency: { type: ['string', 'null'], pattern: '^[A-Za-z]{3}$' },
      inKindDescription: { type: 'string', maxLength: 2000, description: 'Required for an in-kind or mixed agreement.' },
      inKindValueMinor: { type: ['string', 'null'], pattern: '^[0-9]{1,16}$', description: 'The stated estimated value. 08 keeps it out of cash entirely.' },
      purpose: { type: 'string', minLength: 20, maxLength: 4000 },
      obligations: { type: 'string', maxLength: 4000 },
      reportingTerms: { type: 'string', maxLength: 2000, description: 'What the sponsor may see about the people the money reaches. The default is aggregate only.' },
      surplusTerms: { type: 'string', maxLength: 1000, description: 'What happens to money that was not spent. 07 requires it settled at close.' },
      programId: { type: ['string', 'null'], format: 'uuid' },
      projectId: { type: ['string', 'null'], format: 'uuid' },
      startsAt: { type: ['string', 'null'], format: 'date-time' },
      endsAt: { type: ['string', 'null'], format: 'date-time' }
    }
  },
  Agreement: {
    type: 'object',
    description: 'A partnership or grant between two organisations. It creates no equity — `createsEquity` is false and a CHECK constraint keeps it there — because 07 puts any stake on a separate, explicit investment path.',
    properties: {
      id: { type: 'string', format: 'uuid' },
      reference: { type: 'string' },
      title: { type: 'string' },
      kind: ref('AgreementKind'),
      state: ref('AgreementState'),
      stateReason: { type: 'string' },
      amountMinor: { type: ['string', 'null'] },
      currency: { type: ['string', 'null'] },
      termsChecksum: { type: 'string', description: 'The text on the table. An acceptance must quote it.' },
      sentAt: { type: ['string', 'null'], format: 'date-time' },
      activatedAt: { type: ['string', 'null'], format: 'date-time' },
      startsAt: { type: ['string', 'null'], format: 'date-time' },
      endsAt: { type: ['string', 'null'], format: 'date-time' },
      myRole: { type: 'string', enum: ['sponsor', 'operator'], description: 'Which side the reader is on, so no screen works it out from two identifiers.' },
      acceptedBy: { type: 'array', items: { type: 'string' }, description: 'Parties that accepted the *current* version. Accepting an older text counts for nothing.' },
      awaitingAcceptanceFrom: { type: 'array', items: { type: 'string' } },
      fundedMinor: { type: 'string' },
      version: { type: 'integer' },
      createdAt: { type: 'string', format: 'date-time' },
      createsEquity: { type: 'boolean', const: false }
    }
  },
  AgreementMilestone: {
    type: 'object',
    description: 'A deliverable. Approving one is a judgement about evidence and releases no money.',
    properties: {
      id: { type: 'string', format: 'uuid' },
      sequence: { type: 'integer' },
      title: { type: 'string' },
      description: { type: 'string' },
      dueAt: { type: 'string', format: 'date' },
      amountMinor: { type: ['string', 'null'], description: 'Informational. The payout chain releases money, not this.' },
      state: { type: 'string', enum: ['planned', 'evidence_submitted', 'approved', 'changes_requested'] },
      evidenceRef: { type: 'string' },
      evidenceNote: { type: 'string' },
      submittedAt: { type: ['string', 'null'], format: 'date-time' },
      decidedAt: { type: ['string', 'null'], format: 'date-time' },
      version: { type: 'integer' }
    }
  },
  AgreementReport: {
    type: 'object',
    description: '12: counts, never names. A sponsor report that could re-identify somebody is the thing this projection exists to prevent.',
    properties: {
      id: { type: 'string', format: 'uuid' },
      periodStart: { type: 'string', format: 'date' },
      periodEnd: { type: 'string', format: 'date' },
      narrative: { type: 'string' },
      spentMinor: { type: 'string' },
      participantsReached: { type: 'integer' },
      outcomesNote: { type: 'string' },
      varianceNote: { type: 'string' },
      state: { type: 'string', enum: ['draft', 'submitted', 'approved', 'changes_requested'] },
      submittedAt: { type: ['string', 'null'], format: 'date-time' },
      decidedAt: { type: ['string', 'null'], format: 'date-time' },
      decisionReason: { type: 'string' },
      version: { type: 'integer' }
    }
  },
  FundingIntent: {
    type: 'object',
    description: 'A sponsor’s stated intention to fund. No money moves in this build, and no share is created by any amount.',
    properties: {
      id: { type: 'string', format: 'uuid' },
      agreementId: { type: 'string', format: 'uuid' },
      amountMinor: { type: 'string' },
      currency: { type: 'string' },
      committedMinor: { type: ['string', 'null'] },
      fundedMinor: { type: 'string' },
      createsEquity: { type: 'boolean', const: false },
      createsHolding: { type: 'boolean', const: false },
      moneyMoved: { type: 'boolean', const: false },
      awaitingExternalPayment: { type: 'boolean', const: true },
      createdAt: { type: 'string', format: 'date-time' }
    }
  },
  SponsorExport: {
    type: 'object',
    description: 'PRG-11.A04. Counts and money only, with cash and in-kind kept apart. No names and no beneficiary records.',
    properties: {
      generatedAt: { type: 'string', format: 'date-time' },
      agreements: { type: 'array', items: { type: 'object', additionalProperties: true } },
      containsPersonalData: { type: 'boolean', const: false },
      redacted: { type: 'boolean', const: true },
      note: { type: 'string', enum: ['counts_and_money_only'] },
      equityHeld: { type: 'integer', const: 0, description: 'The one number a sponsor might read as ownership, said plainly.' }
    }
  },

  StipendBatch: {
    type: 'object',
    description: 'A period’s stipend for one cohort. The batch is the request; the money is a payout with its own maker, its own independent approver and its own proof of payment.',
    properties: {
      id: { type: 'string', format: 'uuid' },
      cohortId: { type: 'string', format: 'uuid' },
      periodStart: { type: 'string', format: 'date' },
      periodEnd: { type: 'string', format: 'date' },
      currency: { type: 'string' },
      totalMinor: { type: 'string' },
      state: { type: 'string', enum: ['draft', 'requested', 'approved', 'paid', 'cancelled'] },
      stateReason: { type: 'string' },
      payoutId: { type: ['string', 'null'], format: 'uuid' },
      lineCount: { type: 'integer' },
      version: { type: 'integer' },
      createdAt: { type: 'string', format: 'date-time' }
    }
  },
  StipendPreview: {
    type: 'object',
    description: 'What a period would pay, and every reason it could not, computed without writing anything.',
    properties: {
      cohortId: { type: 'string', format: 'uuid' },
      periodStart: { type: 'string', format: 'date' },
      periodEnd: { type: 'string', format: 'date' },
      currency: { type: ['string', 'null'] },
      rateMinor: { type: ['string', 'null'] },
      conditions: { type: 'string', description: 'The programme’s published stipend conditions, returned with the figures rather than left on another page.' },
      sessionsHeld: { type: 'integer' },
      lines: { type: 'array', items: { type: 'object', additionalProperties: true } },
      totalMinor: { type: 'string' },
      ready: { type: 'boolean' },
      blockers: { type: 'array', items: { type: 'string', enum: ['programme_offers_no_stipend', 'stipend_rate_not_set', 'no_sessions_in_period', 'sessions_not_closed', 'objections_open', 'period_already_claimed'] } },
      openSessions: { type: 'array', items: { type: 'object', additionalProperties: true } },
      openObjections: { type: 'integer' },
      alreadyClaimed: { type: 'array', items: { type: 'object', additionalProperties: true } }
    }
  },
  CertificateReadiness: {
    type: 'object',
    description: 'Whether a trainee has finished, with the attendance figure and the programme’s own rule quoted beside it.',
    properties: {
      enrollmentId: { type: 'string', format: 'uuid' },
      eligible: { type: 'boolean' },
      blockers: { type: 'array', items: { type: 'string', enum: ['enrolment_not_completed', 'no_sessions_held', 'attendance_below_policy', 'certificate_already_exists'] } },
      holderName: { type: 'string' },
      programTitle: { type: 'string' },
      issuerName: { type: 'string' },
      completedAt: { type: ['string', 'null'], format: 'date' },
      sessionsHeld: { type: 'integer' },
      sessionsAttended: { type: 'integer' },
      attendanceRatio: { type: 'integer' },
      requiredRatio: { type: 'integer' },
      attendancePolicy: { type: 'string' }
    }
  },
  Certificate: {
    type: 'object',
    description: '07: the public reference carries no national identifier, and a revoked certificate’s reference stays resolvable and says it is no longer valid.',
    properties: {
      id: { type: 'string', format: 'uuid' },
      enrollmentId: { type: 'string', format: 'uuid' },
      publicId: { type: 'string' },
      holderName: { type: 'string' },
      programTitle: { type: 'string' },
      issuerName: { type: 'string' },
      completedAt: { type: 'string', format: 'date' },
      state: { type: 'string', enum: ['issued', 'revoked'] },
      valid: { type: 'boolean' },
      issuedAt: { type: 'string', format: 'date-time' },
      revokedAt: { type: ['string', 'null'], format: 'date-time' },
      version: { type: 'integer' }
    }
  },
  CertificateCheck: {
    type: 'object',
    description: 'The public answer. Enough to attribute the certificate, and nothing else about the person.',
    properties: {
      publicId: { type: 'string' },
      valid: { type: 'boolean' },
      state: { type: 'string', enum: ['issued', 'revoked'] },
      holderName: { type: 'string' },
      programTitle: { type: 'string' },
      issuerName: { type: 'string' },
      completedAt: { type: 'string', format: 'date' },
      issuedAt: { type: 'string', format: 'date-time' },
      revokedAt: { type: ['string', 'null'], format: 'date-time' },
      withheld: { type: 'array', items: { type: 'string' }, description: 'Named, so a reader knows the absence is a rule and not a gap in the record.' }
    }
  },

  ProposalState: { type: 'string', enum: ['draft', 'submitted', 'review', 'accepted', 'rejected', 'active', 'closed', 'withdrawn'] },
  Proposal: {
    type: 'object',
    description: 'A founder’s idea. Private until they send it, and submitting one costs them no share of it.',
    properties: {
      id: { type: 'string', format: 'uuid' },
      reference: { type: 'string' },
      title: { type: 'string' },
      state: ref('ProposalState'),
      stateReason: { type: 'string' },
      stage: { type: 'string' },
      sector: { type: 'string' },
      city: { type: 'string' },
      sharingConsent: { type: 'boolean' },
      submittedAt: { type: ['string', 'null'], format: 'date-time' },
      decidedAt: { type: ['string', 'null'], format: 'date-time' },
      closedAt: { type: ['string', 'null'], format: 'date-time' },
      closeOutcome: { type: 'string' },
      closeNote: { type: 'string' },
      startupOrgId: { type: ['string', 'null'], format: 'uuid', description: 'A company the founder created themselves, where they did. Nothing here creates one.' },
      version: { type: 'integer' },
      createdAt: { type: 'string', format: 'date-time' }
    }
  },
  IncubationAgreementInput: {
    type: 'object',
    required: ['title', 'terms', 'ipTerms'],
    additionalProperties: false,
    properties: {
      title: { type: 'string', minLength: 4, maxLength: 200 },
      terms: { type: 'string', minLength: 20, maxLength: 8000 },
      ipTerms: { type: 'string', minLength: 20, maxLength: 4000, description: 'Required. 07 names it specifically: leaving it unsaid is how founders lose what they built.' },
      responsibilities: { type: 'string', maxLength: 4000 },
      grantMinor: { type: ['string', 'null'], pattern: '^[0-9]{1,16}$', description: 'A grant. It buys nothing.' },
      currency: { type: ['string', 'null'], pattern: '^[A-Za-z]{3}$' },
      grantConditions: { type: 'string', maxLength: 2000 },
      durationMonths: { type: ['integer', 'null'], minimum: 1, maximum: 120 }
    }
  },
  IncubationAgreement: {
    type: 'object',
    description: 'Incubation terms, frozen once offered. There is no equity field: 07 puts any incubator stake on a separate investment path, so the record states the absence rather than leaving a blank somebody could fill in.',
    properties: {
      id: { type: 'string', format: 'uuid' },
      proposalId: { type: 'string', format: 'uuid' },
      sequence: { type: 'integer' },
      title: { type: 'string' },
      terms: { type: 'string' },
      ipTerms: { type: 'string' },
      responsibilities: { type: 'string' },
      grantMinor: { type: ['string', 'null'] },
      currency: { type: ['string', 'null'] },
      grantConditions: { type: 'string' },
      durationMonths: { type: ['integer', 'null'] },
      checksum: { type: 'string', pattern: '^[0-9a-f]{64}$' },
      state: { type: 'string', enum: ['draft', 'offered', 'accepted', 'declined', 'withdrawn', 'closed'] },
      declineReason: { type: 'string' },
      offeredAt: { type: ['string', 'null'], format: 'date-time' },
      respondedAt: { type: ['string', 'null'], format: 'date-time' },
      version: { type: 'integer' },
      grantsEquity: { type: 'boolean', const: false },
      equityPercent: { type: 'integer', const: 0 }
    }
  },
  IncubationMilestone: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      proposalId: { type: 'string', format: 'uuid' },
      sequence: { type: 'integer' },
      title: { type: 'string' },
      description: { type: 'string' },
      dueAt: { type: 'string', format: 'date' },
      state: { type: 'string', enum: ['planned', 'evidence_submitted', 'approved', 'changes_requested'] },
      evidenceRef: { type: 'string' },
      evidenceNote: { type: 'string' },
      submittedAt: { type: ['string', 'null'], format: 'date-time' },
      decidedAt: { type: ['string', 'null'], format: 'date-time' },
      version: { type: 'integer' }
    }
  },

  AssistanceState: { type: 'string', enum: ['draft', 'submitted', 'in_review', 'awaiting_info', 'approved', 'rejected', 'delivered', 'closed', 'disputed', 'withdrawn'] },
  AssistanceCase: {
    type: 'object',
    description: 'A request for help. Processed only while the applicant consents, and never present in a public projection, a sponsor report or an export.',
    properties: {
      id: { type: 'string', format: 'uuid' },
      reference: { type: 'string' },
      category: { type: 'string' },
      state: ref('AssistanceState'),
      stateReason: { type: 'string' },
      submittedAt: { type: ['string', 'null'], format: 'date-time' },
      decidedAt: { type: ['string', 'null'], format: 'date-time' },
      closedAt: { type: ['string', 'null'], format: 'date-time' },
      version: { type: 'integer' },
      createdAt: { type: 'string', format: 'date-time' },
      private: { type: 'boolean', const: true },
      consentGiven: { type: 'boolean' },
      applicantName: { type: ['string', 'null'], description: 'Behind the consent, like everything else about the person. Null once it is withdrawn.' },
      withheldReason: { type: 'string', enum: ['', 'consent_revoked'] }
    }
  },
  AssistanceDelivery: {
    type: 'object',
    description: 'Something handed over. An operator recording it is a claim; the applicant confirming it is the fact.',
    properties: {
      id: { type: 'string', format: 'uuid' },
      caseId: { type: 'string', format: 'uuid' },
      description: { type: 'string' },
      fundingSource: { type: 'string', description: 'Required: 22 forbids an unexplained balance, and an unattributed delivery is the same problem earlier.' },
      amountMinor: { type: ['string', 'null'] },
      currency: { type: ['string', 'null'] },
      evidenceRef: { type: 'string' },
      deliveredAt: { type: 'string', format: 'date' },
      confirmedAt: { type: ['string', 'null'], format: 'date-time' },
      disputedAt: { type: ['string', 'null'], format: 'date-time' },
      disputeReason: { type: 'string' },
      version: { type: 'integer' },
      countsAsDelivered: { type: 'boolean', description: 'True only once the applicant confirmed it.' }
    }
  },

  VolunteerOpportunityInput: {
    type: 'object',
    required: ['title', 'summary', 'tasks', 'supervisorId'],
    additionalProperties: false,
    properties: {
      title: { type: 'string', minLength: 4, maxLength: 200 },
      summary: { type: 'string', minLength: 20, maxLength: 2000 },
      tasks: { type: 'string', minLength: 10, maxLength: 4000 },
      requirements: { type: 'string', maxLength: 2000 },
      supervisorId: { type: 'string', format: 'uuid', description: '07: somebody answerable for the volunteers, and a member of this organisation.' },
      city: { type: 'string', maxLength: 100 },
      deliveryMode: ref('DeliveryMode'),
      capacity: { type: 'integer', minimum: 1, maximum: 10000 },
      hoursPerWeek: { type: 'integer', minimum: 0, maximum: 80 },
      startsAt: { type: ['string', 'null'], format: 'date' },
      endsAt: { type: ['string', 'null'], format: 'date' },
      withdrawalPolicy: { type: 'string', maxLength: 1000, description: 'Published before anybody applies, so a volunteer knows how they can stop.' }
    }
  },
  VolunteerOpportunity: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      slug: { type: 'string' },
      title: { type: 'string' },
      summary: { type: 'string' },
      tasks: { type: 'string' },
      requirements: { type: 'string' },
      city: { type: 'string' },
      deliveryMode: ref('DeliveryMode'),
      capacity: { type: 'integer' },
      hoursPerWeek: { type: 'integer' },
      startsAt: { type: ['string', 'null'], format: 'date' },
      endsAt: { type: ['string', 'null'], format: 'date' },
      withdrawalPolicy: { type: 'string' },
      state: { type: 'string', enum: ['draft', 'open', 'paused', 'closed'] },
      stateReason: { type: 'string' },
      version: { type: 'integer' },
      createdAt: { type: 'string', format: 'date-time' },
      isPaid: { type: 'boolean', const: false }
    }
  },
  PublicVolunteerOpportunity: {
    type: 'object',
    description: 'Built field by field. It names no volunteer and no supervisor, and states that volunteering is unpaid and is not employment.',
    properties: {
      slug: { type: 'string' },
      title: { type: 'string' },
      summary: { type: 'string' },
      city: { type: 'string' },
      deliveryMode: ref('DeliveryMode'),
      capacity: { type: 'integer' },
      placesLeft: { type: 'integer' },
      hoursPerWeek: { type: 'integer' },
      startsAt: { type: ['string', 'null'], format: 'date' },
      endsAt: { type: ['string', 'null'], format: 'date' },
      state: { type: 'string' },
      acceptsApplications: { type: 'boolean' },
      applicationsUnavailableReason: { type: 'string' },
      organization: { type: 'object', properties: { slug: { type: 'string' }, displayName: { type: 'string' }, city: { type: 'string' }, verified: { type: 'boolean' } } },
      hasNamedSupervisor: { type: 'boolean', const: true },
      isPaid: { type: 'boolean', const: false },
      isEmployment: { type: 'boolean', const: false }
    }
  },
  VolunteerReadiness: {
    type: 'object',
    properties: {
      ready: { type: 'boolean' },
      blockers: { type: 'array', items: { type: 'string', enum: ['summary_too_short', 'tasks_not_described', 'withdrawal_policy_missing', 'capacity_invalid'] } }
    }
  },
  VolunteerApplication: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      opportunityId: { type: 'string', format: 'uuid' },
      state: { type: 'string', enum: ['submitted', 'accepted', 'rejected', 'withdrawn'] },
      decisionReason: { type: 'string' },
      decidedAt: { type: ['string', 'null'], format: 'date-time' },
      version: { type: 'integer' },
      createdAt: { type: 'string', format: 'date-time' }
    }
  },
  VolunteerAssignment: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      opportunityId: { type: 'string', format: 'uuid' },
      task: { type: 'string' },
      startsAt: { type: 'string', format: 'date' },
      endsAt: { type: ['string', 'null'], format: 'date' },
      state: { type: 'string', enum: ['offered', 'accepted', 'declined', 'active', 'ended'] },
      endReason: { type: 'string' },
      acceptedAt: { type: ['string', 'null'], format: 'date-time' },
      version: { type: 'integer' },
      createdAt: { type: 'string', format: 'date-time' }
    }
  },
  VolunteerHours: {
    type: 'object',
    description: 'Hours a volunteer says they worked. Only approved ones count, and the approver is never the volunteer.',
    properties: {
      id: { type: 'string', format: 'uuid' },
      assignmentId: { type: 'string', format: 'uuid' },
      workedOn: { type: 'string', format: 'date' },
      minutes: { type: 'integer' },
      note: { type: 'string' },
      state: { type: 'string', enum: ['submitted', 'approved', 'rejected'] },
      approvedAt: { type: ['string', 'null'], format: 'date-time' },
      decisionReason: { type: 'string' },
      version: { type: 'integer' },
      counted: { type: 'boolean' }
    }
  }
} as const;

/** Better Auth paths this API deliberately exposes. Kept in step with AUTH_ROUTES by the drift test. */
const authPaths = {
  '/auth/sign-up/email': { post: operation({ id: 'authRegister', summary: 'Create an account and accept the current terms version.', tag: 'auth', permission: 'public', public: true, body: { type: 'object', required: ['email', 'password', 'name'], properties: { email: { type: 'string', format: 'email' }, password: { type: 'string', minLength: 12 }, name: { type: 'string' }, termsVersion: { type: 'string' } } }, success: { status: 200, description: 'Account created; a verification link is queued for local delivery.' } }) },
  '/auth/sign-in/email': { post: operation({ id: 'authLogin', summary: 'Sign in. Accounts with TOTP receive no authenticated session until the second factor passes.', tag: 'auth', permission: 'public', public: true, body: { type: 'object', required: ['email', 'password'], properties: { email: { type: 'string', format: 'email' }, password: { type: 'string' } } }, success: { status: 200, description: 'Session cookie set, or a two-factor continuation.' } }) },
  '/auth/sign-out': { post: operation({ id: 'authLogout', summary: 'Revoke the current session.', tag: 'auth', permission: 'self', success: { status: 200, description: 'Session revoked.' } }) },
  '/auth/send-verification-email': { post: operation({ id: 'authResendVerification', summary: 'Queue another verification link. The reply never reveals whether the address exists.', tag: 'auth', permission: 'public', public: true, body: { type: 'object', required: ['email'], properties: { email: { type: 'string', format: 'email' } } }, success: { status: 200, description: 'Generic acknowledgement.' } }) },
  '/auth/verify-email': { get: operation({ id: 'authVerifyEmail', summary: 'Consume a verification token. Concurrent opens resolve to exactly one success.', tag: 'auth', permission: 'token owner', public: true, query: [{ name: 'token', description: 'Signed verification token.', required: true }], success: { status: 302, description: 'Redirect to the web result page.' } }) },
  '/auth/request-password-reset': { post: operation({ id: 'authRequestPasswordReset', summary: 'Request a recovery link. Rate limited, with a reply that does not disclose the account.', tag: 'auth', permission: 'public', public: true, body: { type: 'object', required: ['email'], properties: { email: { type: 'string', format: 'email' }, redirectTo: { type: 'string' } } }, success: { status: 200, description: 'Generic acknowledgement.' }, errors: { 429: errorResponse('Rate limited; retry after the advertised delay.') } }) },
  '/auth/reset-password': { post: operation({ id: 'authResetPassword', summary: 'Set a new password with a single-use token and revoke existing sessions.', tag: 'auth', permission: 'token owner', public: true, body: { type: 'object', required: ['token', 'newPassword'], properties: { token: { type: 'string' }, newPassword: { type: 'string', minLength: 12 } } }, success: { status: 200, description: 'Password replaced and sessions revoked.' } }) },
  '/auth/two-factor/enable': { post: operation({ id: 'authEnableTotp', summary: 'Begin TOTP enrolment and issue recovery codes.', tag: 'auth', permission: 'self', body: { type: 'object', required: ['password'], properties: { password: { type: 'string' } } }, success: { status: 200, description: 'TOTP URI and backup codes, shown once.' } }) },
  '/auth/two-factor/disable': { post: operation({ id: 'authDisableTotp', summary: 'Disable TOTP for the signed-in account.', tag: 'auth', permission: 'self', body: { type: 'object', required: ['password'], properties: { password: { type: 'string' } } }, success: { status: 200, description: 'TOTP disabled.' } }) },
  '/auth/two-factor/verify-totp': { post: operation({ id: 'authVerifyTotp', summary: 'Confirm a TOTP code, either to finish enrolment or to complete sign-in.', tag: 'auth', permission: 'self', body: { type: 'object', required: ['code'], properties: { code: { type: 'string', pattern: '^[0-9]{6}$' }, trustDevice: { type: 'boolean' } } }, success: { status: 200, description: 'Second factor accepted.' } }) },
  '/auth/two-factor/verify-backup-code': { post: operation({ id: 'authVerifyBackupCode', summary: 'Complete the second factor with a recovery code.', tag: 'auth', permission: 'self', body: { type: 'object', required: ['code'], properties: { code: { type: 'string' }, disableSession: { type: 'boolean' }, trustDevice: { type: 'boolean' } } }, success: { status: 200, description: 'Recovery code accepted and consumed.' } }) },
  '/auth/two-factor/generate-backup-codes': { post: operation({ id: 'authGenerateBackupCodes', summary: 'Replace the stored recovery codes.', tag: 'auth', permission: 'self', body: { type: 'object', required: ['password'], properties: { password: { type: 'string' } } }, success: { status: 200, description: 'New recovery codes, shown once.' } }) }
};

const paths = {
  '/health/live': { get: operation({ id: 'healthLive', summary: 'Liveness. Independent of the database on purpose.', tag: 'health', permission: 'public', public: true, success: { status: 200, description: 'Process is running.', schema: { type: 'object', properties: { status: { type: 'string' }, service: { type: 'string' } } } } }) },
  '/health/ready': { get: operation({ id: 'healthReady', summary: 'Readiness. Requires the expected schema marker in PostgreSQL.', tag: 'health', permission: 'public', public: true, success: { status: 200, description: 'Database and schema reachable.', schema: { type: 'object', properties: { status: { type: 'string' }, checks: { type: 'object', additionalProperties: { type: 'string' } } } } }, errors: { 503: errorResponse('Not ready. The body is redacted and never names the database or credentials.') } }) },

  ...authPaths,

  '/me': { get: operation({ id: 'getMe', summary: 'The signed-in human, profile, organisation contexts and platform grants.', tag: 'identity', permission: 'self', success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('Me')) } }) },
  '/me/profile': { patch: operation({ id: 'updateProfile', summary: 'Update the individual profile and capabilities. Capabilities never grant financial eligibility.', tag: 'identity', permission: 'profile.manage (self)', body: { type: 'object', required: ['displayName', 'city', 'locale', 'capabilities', 'version'], additionalProperties: false, properties: { displayName: { type: 'string', minLength: 2, maxLength: 100 }, city: { type: 'string', maxLength: 100 }, locale: { type: 'string', enum: ['ar', 'en'] }, capabilities: { type: 'array', maxItems: 5, items: ref('Capability') }, version: { type: 'integer', minimum: 1 } } }, success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('Profile')) } }) },
  '/me/context': { post: operation({ id: 'switchContext', summary: 'Switch the active context. Switching is not a permission: membership is re-checked server side.', tag: 'identity', permission: 'organization.read on the target, or null for personal', body: { type: 'object', required: ['organizationId'], additionalProperties: false, properties: { organizationId: { type: ['string', 'null'], format: 'uuid' } } }, success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { organizationId: { type: ['string', 'null'], format: 'uuid' } } }) } }) },

  '/sessions': { get: operation({ id: 'listSessions', summary: 'Active sessions for this account, without tokens.', tag: 'identity', permission: 'self', success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'array', items: ref('AccountSession') }) } }) },
  '/sessions/{id}/revoke': { post: operation({ id: 'revokeSession', summary: 'Revoke one owned session. A session belonging to another account returns 404, not 403.', tag: 'identity', permission: 'self', params: [uuidParam('id', 'Session identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { id: { type: 'string', format: 'uuid' }, current: { type: 'boolean' }, status: { type: 'string', enum: ['revoked'] } } }) } }) },

  '/auth/mfa/challenges': { post: operation({ id: 'createVerificationDecisionChallenge', summary: 'Open a step-up challenge for a verification decision.', tag: 'mfa', permission: 'verification.review', body: { type: 'object', required: ['submissionId', 'version'], additionalProperties: false, properties: { submissionId: { type: 'string', format: 'uuid' }, version: { type: 'integer', minimum: 1 } } }, success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('MfaChallenge')) } }) },
  '/auth/mfa/challenges/{challengeId}/verify': { post: operation({ id: 'verifyMfaChallenge', summary: 'Pass a step-up challenge with a TOTP code. Five failed attempts cancel it.', tag: 'mfa', permission: 'self', params: [uuidParam('challengeId', 'Challenge identifier.')], body: { type: 'object', required: ['code'], additionalProperties: false, properties: { code: { type: 'string', pattern: '^[0-9]{6}$' } } }, success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { id: { type: 'string', format: 'uuid' }, state: { type: 'string', enum: ['verified'] } } }) } }) },
  '/auth/mfa/challenges/{challengeId}/recovery-verify': { post: operation({ id: 'verifyMfaChallengeWithRecoveryCode', summary: 'Pass a step-up challenge with a recovery code.', tag: 'mfa', permission: 'self', params: [uuidParam('challengeId', 'Challenge identifier.')], body: { type: 'object', required: ['code'], additionalProperties: false, properties: { code: { type: 'string', minLength: 6, maxLength: 64 } } }, success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { id: { type: 'string', format: 'uuid' }, state: { type: 'string', enum: ['verified'] } } }) } }) },
  '/auth/mfa/challenges/{challengeId}/cancel': { post: operation({ id: 'cancelMfaChallenge', summary: 'Abandon a step-up challenge without performing the operation.', tag: 'mfa', permission: 'self', params: [uuidParam('challengeId', 'Challenge identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { id: { type: 'string', format: 'uuid' }, state: { type: 'string', enum: ['cancelled'] } } }) } }) },

  '/orgs': { post: operation({ id: 'createOrganization', summary: 'Create an organisation. The creator becomes Owner; a Party row is created in the same transaction.', tag: 'organizations', permission: 'self (verified email)', body: { type: 'object', required: ['legalName', 'displayName', 'city', 'country', 'type'], additionalProperties: false, properties: { legalName: { type: 'string', minLength: 2, maxLength: 200 }, displayName: { type: 'string', minLength: 2, maxLength: 140 }, city: { type: 'string', minLength: 2, maxLength: 100 }, country: { type: 'string', pattern: '^[A-Z]{2}$' }, type: ref('OrganizationType') } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('Organization')) } }) },
  '/orgs/{id}': {
    get: operation({ id: 'getOrganization', summary: 'Read an organisation as a member.', tag: 'organizations', permission: 'organization.read', params: [uuidParam('id', 'Organisation identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('Organization')) } }),
    patch: operation({ id: 'updateOrganization', summary: 'Update organisation settings. Changing the legal name of a verified organisation forces re-verification.', tag: 'organizations', permission: 'organization.manage', params: [uuidParam('id', 'Organisation identifier.')], body: { type: 'object', required: ['displayName', 'legalName', 'slug', 'publicDescription', 'sectors', 'city', 'country', 'version'], additionalProperties: false, properties: { displayName: { type: 'string' }, legalName: { type: 'string' }, slug: { type: 'string' }, publicDescription: { type: 'string', maxLength: 1200 }, sectors: { type: 'array', maxItems: 10, items: { type: 'string' } }, contactEmail: { type: ['string', 'null'] }, websiteUrl: { type: ['string', 'null'] }, contactAddress: { type: ['string', 'null'] }, city: { type: 'string' }, country: { type: 'string', pattern: '^[A-Z]{2}$' }, version: { type: 'integer', minimum: 1 } } }, success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('Organization')) } })
  },
  '/orgs/{id}/public-preview': { get: operation({ id: 'previewPublicOrganization', summary: 'Preview the allowlisted public projection before publishing.', tag: 'organizations', permission: 'organization.manage', params: [uuidParam('id', 'Organisation identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('PublicOrganization')) } }) },
  '/organizations/{slug}/logo': { get: operation({ id: 'getPublicOrganizationLogo', summary: 'Serve the current clean logo by public slug, with ETag and nosniff. Demo/test storage only.', tag: 'organizations', permission: 'public', public: true, params: [tokenParam('slug', 'Public organisation slug.')], success: { status: 200, description: 'Image bytes with a Content-Type fixed from the stored record.', contentType: 'image/png', schema: { type: 'string', format: 'binary' } }, errors: { 304: { description: 'Not modified.' } } }) },

  '/orgs/{id}/logo/upload-intents': { post: operation({ id: 'createLogoUploadIntent', summary: 'Open a single-use logo upload grant. The current logo stays published until a replacement passes.', tag: 'organizations', permission: 'organization.manage', params: [uuidParam('id', 'Organisation identifier.')], body: { type: 'object', required: ['fileName', 'contentType', 'size', 'version'], additionalProperties: false, properties: { fileName: { type: 'string', maxLength: 255 }, contentType: { type: 'string', enum: ['image/png', 'image/jpeg'] }, size: { type: 'integer', minimum: 24, maximum: 10485760 }, version: { type: 'integer', minimum: 1 } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('UploadIntent')) } }) },
  '/orgs/{id}/logo/{assetId}/content': { put: operation({ id: 'uploadLogoContent', summary: 'Upload the logo bytes into quarantine. Content-Length and Content-Type must match the intent exactly.', tag: 'organizations', permission: 'organization.manage', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('assetId', 'Logo asset identifier.')], headers: uploadTokenHeader, body: { type: 'string', format: 'binary' }, bodyContentType: 'application/octet-stream', success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { id: { type: 'string', format: 'uuid' }, received: { type: 'integer' } } }) } }) },
  '/orgs/{id}/logo/{assetId}/finalize': { post: operation({ id: 'finalizeLogo', summary: 'Inspect magic bytes and dimensions, then publish atomically or reject.', tag: 'organizations', permission: 'organization.manage', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('assetId', 'Logo asset identifier.')], headers: uploadTokenHeader, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { id: { type: 'string', format: 'uuid' }, scanState: ref('ScanState'), scanReason: { type: ['string', 'null'] }, logoUrl: { type: ['string', 'null'] } } }) } }) },

  '/orgs/{id}/verification': {
    get: operation({ id: 'getVerificationCase', summary: 'Read the verification draft, documents and submission history.', tag: 'verification', permission: 'organization.manage', params: [uuidParam('id', 'Organisation identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('VerificationCase')) } }),
    patch: operation({ id: 'saveVerificationCase', summary: 'Save the draft. Editable only in not_started or changes_requested.', tag: 'verification', permission: 'organization.manage', params: [uuidParam('id', 'Organisation identifier.')], body: { type: 'object', required: ['registrationNumber', 'issuingAuthority', 'registeredAddress', 'version'], additionalProperties: false, properties: { registrationNumber: { type: 'string', maxLength: 100 }, issuingAuthority: { type: 'string', maxLength: 200 }, registeredAddress: { type: 'string', maxLength: 300 }, documentExpiresAt: { type: ['string', 'null'], format: 'date' }, version: { type: 'integer', minimum: 0, description: 'Zero creates the first draft.' } } }, success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('VerificationCase')) } })
  },
  '/orgs/{id}/verification/submissions': { post: operation({ id: 'submitVerificationCase', summary: 'Submit an immutable snapshot. Refused unless every document is clean and the fields are complete.', tag: 'verification', permission: 'organization.manage', params: [uuidParam('id', 'Organisation identifier.')], body: versionBody('Verification case version.'), success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { id: { type: 'string', format: 'uuid' }, sequence: { type: 'integer' }, state: ref('VerificationState'), submittedAt: { type: 'string', format: 'date-time' } } }) } }) },
  '/orgs/{id}/verification/documents/upload-intents': { post: operation({ id: 'createVerificationUploadIntent', summary: 'Open a single-use document upload grant. Documents are classified HighlySensitive.', tag: 'verification', permission: 'organization.manage', params: [uuidParam('id', 'Organisation identifier.')], body: { type: 'object', required: ['fileName', 'contentType', 'size', 'version'], additionalProperties: false, properties: { fileName: { type: 'string', maxLength: 255 }, contentType: { type: 'string', enum: ['application/pdf', 'image/png', 'image/jpeg'] }, size: { type: 'integer', minimum: 5, maximum: 20971520 }, version: { type: 'integer', minimum: 1 } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('UploadIntent')) } }) },
  '/orgs/{id}/verification/documents/{documentId}/content': { put: operation({ id: 'uploadVerificationDocumentContent', summary: 'Upload document bytes into quarantine.', tag: 'verification', permission: 'organization.manage', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('documentId', 'Document identifier.')], headers: uploadTokenHeader, body: { type: 'string', format: 'binary' }, bodyContentType: 'application/octet-stream', success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { id: { type: 'string', format: 'uuid' }, received: { type: 'integer' } } }) } }) },
  '/orgs/{id}/verification/documents/{documentId}/finalize': { post: operation({ id: 'finalizeVerificationDocument', summary: 'Run the conservative local inspection and promote to clean storage, or reject.', tag: 'verification', permission: 'organization.manage', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('documentId', 'Document identifier.')], headers: uploadTokenHeader, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { id: { type: 'string', format: 'uuid' }, fileName: { type: 'string' }, scanState: ref('ScanState'), scanReason: { type: ['string', 'null'] } } }) } }) },
  '/orgs/{id}/verification/decisions': { get: operation({ id: 'listVerificationDecisions', summary: 'Public-facing decision history for the organisation. Reviewer identity is withheld.', tag: 'verification', permission: 'organization.manage', params: [uuidParam('id', 'Organisation identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'array', items: ref('VerificationDecision') }) } }) },

  '/orgs/{id}/members': { get: operation({ id: 'listMembers', summary: 'List organisation members.', tag: 'team', permission: 'member.read', params: [uuidParam('id', 'Organisation identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'array', items: ref('Member') }) } }) },
  '/orgs/{id}/members/{userId}': { patch: operation({ id: 'changeMembership', summary: 'Change roles or suspend a member. Suspension revokes their sessions; Owner is out of scope here.', tag: 'team', permission: 'member.role.update', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('userId', 'Member user identifier.')], body: { type: 'object', required: ['roles', 'status', 'version'], additionalProperties: false, properties: { roles: { type: 'array', minItems: 1, items: ref('MembershipRole') }, status: { type: 'string', enum: ['active', 'suspended'] }, version: { type: 'integer', minimum: 1 } } }, success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('Member')) } }) },
  '/orgs/{id}/invitations': {
    get: operation({ id: 'listInvitations', summary: 'List invitations for the organisation.', tag: 'team', permission: 'member.invite', params: [uuidParam('id', 'Organisation identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'array', items: ref('Invitation') }) } }),
    post: operation({ id: 'createInvitation', summary: 'Invite a member. Roles may not exceed the inviter’s own permissions, and the token is not returned.', tag: 'team', permission: 'member.invite', params: [uuidParam('id', 'Organisation identifier.')], body: { type: 'object', required: ['email', 'roles'], additionalProperties: false, properties: { email: { type: 'string', format: 'email' }, roles: { type: 'array', minItems: 1, maxItems: 10, items: ref('MembershipRole') } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { id: { type: 'string', format: 'uuid' }, expiresAt: { type: 'string', format: 'date-time' } } }) } })
  },
  '/orgs/{id}/invitations/{invitationId}/revoke': { post: operation({ id: 'revokeInvitation', summary: 'Revoke a pending invitation. Accepted, declined and revoked are mutually exclusive terminal states.', tag: 'team', permission: 'member.invite', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('invitationId', 'Invitation identifier.')], success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { id: { type: 'string', format: 'uuid' }, status: { type: 'string', enum: ['revoked'] } } }) } }) },
  '/invitations/{token}': { get: operation({ id: 'previewInvitation', summary: 'Preview an invitation. Only the signed-in, email-verified recipient may read it.', tag: 'team', permission: 'token owner (matching verified email)', params: [tokenParam('token', 'Opaque invitation token.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('InvitationPreview')) } }) },
  '/invitations/{token}/accept': { post: operation({ id: 'acceptInvitation', summary: 'Accept an invitation. The inviter’s current permissions are re-checked at acceptance time.', tag: 'team', permission: 'token owner (matching verified email)', params: [tokenParam('token', 'Opaque invitation token.')], success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('Member')) } }) },
  '/invitations/{token}/decline': { post: operation({ id: 'declineInvitation', summary: 'Decline an invitation. No membership is created.', tag: 'team', permission: 'token owner (matching verified email)', params: [tokenParam('token', 'Opaque invitation token.')], success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { status: { type: 'string', enum: ['declined'] } } }) } }) },

  '/orgs/{id}/ownership-transfers/challenge': { post: operation({ id: 'createOwnershipTransferChallenge', summary: 'Open a step-up challenge bound to the organisation and its version.', tag: 'ownership', permission: 'ownership.transfer', params: [uuidParam('id', 'Organisation identifier.')], body: versionBody('Organisation version.'), success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('MfaChallenge')) } }) },
  '/orgs/{id}/ownership-transfers': { post: operation({ id: 'createOwnershipTransfer', summary: 'Request an ownership transfer. The current owner keeps ownership until the recipient accepts.', tag: 'ownership', permission: 'ownership.transfer', params: [uuidParam('id', 'Organisation identifier.')], body: { type: 'object', required: ['targetUserId', 'version', 'mfaChallengeId'], additionalProperties: false, properties: { targetUserId: { type: 'string', format: 'uuid' }, version: { type: 'integer', minimum: 1 }, mfaChallengeId: { type: 'string', format: 'uuid' } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { id: { type: 'string', format: 'uuid' }, expiresAt: { type: 'string', format: 'date-time' }, status: { type: 'string' } } }) } }) },
  '/ownership-transfers/{token}': { get: operation({ id: 'previewOwnershipTransfer', summary: 'Preview a pending transfer as the named recipient.', tag: 'ownership', permission: 'token owner (named recipient)', params: [tokenParam('token', 'Opaque transfer token.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { organization: ref('PublicOrganization'), currentOwner: { type: 'object', properties: { name: { type: 'string' } } }, expiresAt: { type: 'string', format: 'date-time' }, requiresMfaSetup: { type: 'boolean' }, status: { type: 'string', enum: ['pending', 'accepted', 'expired'] } } }) } }) },
  '/ownership-transfers/{token}/accept': { post: operation({ id: 'acceptOwnershipTransfer', summary: 'Accept ownership. Roles swap atomically and both parties’ sessions are revoked.', tag: 'ownership', permission: 'token owner (named recipient with MFA)', params: [tokenParam('token', 'Opaque transfer token.')], success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { organizationId: { type: 'string', format: 'uuid' }, status: { type: 'string', enum: ['accepted'] }, requiresReauthentication: { type: 'boolean' } } }) } }) },

  '/orgs/{id}/bank-settings': { get: operation({ id: 'getBankSettings', summary: 'Read the active bank account summary and the change-request history.', tag: 'bank', permission: 'bank.manage', params: [uuidParam('id', 'Organisation identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { activeAccount: { oneOf: [ref('BankAccountSummary'), { type: 'null' }] }, requests: { type: 'array', items: ref('BankChangeRequest') } } }) } }) },
  '/orgs/{id}/bank-change-requests/challenge': { post: operation({ id: 'createBankChangeChallenge', summary: 'Open a step-up challenge for a bank account change.', tag: 'bank', permission: 'bank.manage', params: [uuidParam('id', 'Organisation identifier.')], body: versionBody('Organisation version.'), success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('MfaChallenge')) } }) },
  '/orgs/{id}/bank-change-requests': { post: operation({ id: 'createBankChangeRequest', summary: 'Request a bank account change. It is queued for independent review and never applied directly.', tag: 'bank', permission: 'bank.manage', params: [uuidParam('id', 'Organisation identifier.')], body: { type: 'object', required: ['bankName', 'accountHolder', 'iban', 'country', 'currency', 'version', 'mfaChallengeId'], additionalProperties: false, properties: { bankName: { type: 'string', minLength: 2, maxLength: 140 }, accountHolder: { type: 'string', minLength: 2, maxLength: 200 }, iban: { type: 'string', minLength: 15, maxLength: 42, description: 'Validated by ISO 7064 mod-97; stored encrypted and never returned.' }, country: { type: 'string', pattern: '^[A-Za-z]{2}$' }, currency: { type: 'string', pattern: '^[A-Za-z]{3}$' }, version: { type: 'integer', minimum: 1 }, mfaChallengeId: { type: 'string', format: 'uuid' } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { id: { type: 'string', format: 'uuid' }, state: { type: 'string', enum: ['pending'] }, version: { type: 'integer' }, accountLast4: { type: 'string' }, createdAt: { type: 'string', format: 'date-time' } } }) } }) },

  '/admin/bank-change-requests': { get: operation({ id: 'listBankChangeReviewQueue', summary: 'Pending bank changes awaiting a finance operator. Stale entries are flagged and cannot be decided.', tag: 'admin', permission: 'FinanceOperator grant with MFA', success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'array', items: { allOf: [ref('BankChangeRequest'), { type: 'object', properties: { stale: { type: 'boolean' }, organizationVersion: { type: 'integer' }, organization: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, displayName: { type: 'string' }, verification: ref('VerificationState'), country: { type: 'string' }, version: { type: 'integer' } } }, requester: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string' } } } } }] } }) } }) },
  '/admin/bank-change-requests/{requestId}/challenge': { post: operation({ id: 'createBankChangeReviewChallenge', summary: 'Open a step-up challenge for a bank decision. The requester may not review their own request.', tag: 'admin', permission: 'FinanceOperator grant with MFA', params: [uuidParam('requestId', 'Bank change request identifier.')], body: versionBody('Bank change request version.'), success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('MfaChallenge')) } }) },
  '/admin/bank-change-requests/{requestId}/decision': { post: operation({ id: 'decideBankChange', summary: 'Approve or reject a bank change. Approval is the only path that installs the active account.', tag: 'admin', permission: 'FinanceOperator grant with MFA', params: [uuidParam('requestId', 'Bank change request identifier.')], body: { type: 'object', required: ['outcome', 'reason', 'version', 'mfaChallengeId'], additionalProperties: false, properties: { outcome: { type: 'string', enum: ['approved', 'rejected'] }, reason: { type: 'string', maxLength: 1000, description: 'Required, at least 10 characters, when rejecting.' }, version: { type: 'integer', minimum: 1 }, mfaChallengeId: { type: 'string', format: 'uuid' } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { id: { type: 'string', format: 'uuid' }, state: { type: 'string', enum: ['approved', 'rejected'] }, reviewedAt: { type: 'string', format: 'date-time' }, activeAccountChanged: { type: 'boolean' } } }) } }) },

  '/admin/verifications': { get: operation({ id: 'listVerificationReviewQueue', summary: 'Unclaimed or self-claimed verification submissions.', tag: 'admin', permission: 'VerificationReviewer grant with MFA', success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'array', items: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, sequence: { type: 'integer' }, submittedAt: { type: 'string', format: 'date-time' } } } }) } }) },
  '/admin/verifications/{submissionId}': { get: operation({ id: 'getVerificationReview', summary: 'Read a submission for review. A case claimed by another reviewer returns 404.', tag: 'admin', permission: 'VerificationReviewer grant with MFA', params: [uuidParam('submissionId', 'Submission identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', additionalProperties: true }) } }) },
  '/admin/verifications/{submissionId}/claim': { post: operation({ id: 'claimVerificationReview', summary: 'Claim a submission atomically so two reviewers cannot decide the same case.', tag: 'admin', permission: 'VerificationReviewer grant with MFA', params: [uuidParam('submissionId', 'Submission identifier.')], success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { submissionId: { type: 'string', format: 'uuid' }, state: ref('VerificationState'), version: { type: 'integer' } } }) } }) },
  '/admin/verifications/{submissionId}/decision': { post: operation({ id: 'decideVerificationReview', summary: 'Record an append-only verification decision and update the organisation atomically.', tag: 'admin', permission: 'VerificationReviewer grant with MFA', params: [uuidParam('submissionId', 'Submission identifier.')], body: { type: 'object', required: ['outcome', 'publicReason', 'version', 'mfaChallengeId'], additionalProperties: false, properties: { outcome: { type: 'string', enum: ['changes_requested', 'verified', 'rejected'] }, publicReason: { type: 'string', maxLength: 1000 }, version: { type: 'integer', minimum: 1 }, mfaChallengeId: { type: 'string', format: 'uuid' } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('VerificationDecision')) } }) },

  '/admin/team': { get: operation({ id: 'getPlatformTeam', summary: 'Active platform grants and pending staff invitations.', tag: 'admin', permission: 'PlatformAdmin grant with MFA', success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('PlatformTeam')) } }) },
  '/admin/team/invitations': { post: operation({ id: 'invitePlatformStaff', summary: 'Invite platform staff with explicit, time-boxed grants of at most 90 days.', tag: 'admin', permission: 'PlatformAdmin grant with MFA', body: { type: 'object', required: ['email', 'roles', 'grantExpiresAt'], additionalProperties: false, properties: { email: { type: 'string', format: 'email' }, roles: { type: 'array', minItems: 1, maxItems: 7, items: ref('PlatformRole') }, grantExpiresAt: { type: 'string', format: 'date-time' } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { id: { type: 'string', format: 'uuid' }, expiresAt: { type: 'string', format: 'date-time' } } }) } }) },
  '/admin/team/{userId}/grants': { post: operation({ id: 'replacePlatformGrants', summary: 'Replace a staff member’s grants. Previous grants are revoked, not deleted, and sessions are ended.', tag: 'admin', permission: 'PlatformAdmin grant with MFA', params: [uuidParam('userId', 'Staff user identifier.')], body: { type: 'object', required: ['roles', 'expiresAt', 'version'], additionalProperties: false, properties: { roles: { type: 'array', minItems: 1, maxItems: 7, items: ref('PlatformRole') }, expiresAt: { type: 'string', format: 'date-time' }, version: { type: 'integer', minimum: 1, description: 'platformAccessVersion.' } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { userId: { type: 'string', format: 'uuid' }, roles: { type: 'array', items: ref('PlatformRole') }, expiresAt: { type: 'string', format: 'date-time' }, version: { type: 'integer' } } }) } }) },
  '/admin/team/{userId}/revoke': { post: operation({ id: 'revokePlatformAccess', summary: 'Revoke all platform access and end the staff member’s sessions immediately.', tag: 'admin', permission: 'PlatformAdmin grant with MFA', params: [uuidParam('userId', 'Staff user identifier.')], body: versionBody('platformAccessVersion.'), success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { userId: { type: 'string', format: 'uuid' }, status: { type: 'string', enum: ['revoked'] }, version: { type: 'integer' } } }) } }) },
  '/platform-invitations/{token}': { get: operation({ id: 'previewPlatformInvitation', summary: 'Preview a staff invitation as the named recipient.', tag: 'admin', permission: 'token owner (matching verified email)', params: [tokenParam('token', 'Opaque staff invitation token.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { roles: { type: 'array', items: ref('PlatformRole') }, grantExpiresAt: { type: 'string', format: 'date-time' }, expiresAt: { type: 'string', format: 'date-time' }, inviter: { type: 'object', properties: { name: { type: 'string' } } }, requiresMfaSetup: { type: 'boolean' }, status: { type: 'string' } } }) } }) },
  '/platform-invitations/{token}/accept': { post: operation({ id: 'acceptPlatformInvitation', summary: 'Accept staff access. Requires a verified email and an enabled second factor.', tag: 'admin', permission: 'token owner (matching verified email with MFA)', params: [tokenParam('token', 'Opaque staff invitation token.')], success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { status: { type: 'string', enum: ['accepted'] }, roles: { type: 'array', items: ref('PlatformRole') } } }) } }) },

  // ---- PART-04: projects, public browsing and the map --------------------------------------
  '/cities': { get: operation({ id: 'listCities', summary: 'Reference cities available for a project location and for filtering.', tag: 'projects', permission: 'public', public: true, success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'array', items: ref('City') }) } }) },
  '/projects': { get: operation({ id: 'browseProjects', summary: 'Browse published projects. Unpublished projects are absent, not hidden.', tag: 'projects', permission: 'public', public: true, query: browseFilters, success: { status: 200, description: 'Cursor page of public project cards.', schema: { type: 'object', required: ['data'], properties: { data: { type: 'array', items: ref('PublicProjectCard') }, page: ref('CursorPage') }, additionalProperties: true } } }) },
  '/projects/{slug}': { get: operation({ id: 'getPublicProject', summary: 'Public project detail. A draft or archived project returns 404 rather than revealing it exists.', tag: 'projects', permission: 'public', public: true, params: [tokenParam('slug', 'Public project slug.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('PublicProjectDetail')) } }) },
  '/map/projects': { get: operation({ id: 'mapProjects', summary: 'Public map points for the current filters, with the list the same data drives.', tag: 'projects', permission: 'public', public: true, query: [...browseFilters, { name: 'bbox', description: 'minLat,minLon,maxLat,maxLon. Ignored when malformed.' }], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'array', items: ref('PublicProjectCard') }) } }) },
  '/organizations': { get: operation({ id: 'browseOrganizations', summary: 'Public organisation directory. An expired verification is not counted as verified.', tag: 'organizations', permission: 'public', public: true, query: browseFilters, success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'array', items: ref('PublicOrganizationSummary') }) } }) },
  '/organizations/{slug}/profile': { get: operation({ id: 'getPublicOrganizationProfile', summary: 'Public organisation profile and its published projects. Never includes the legal name.', tag: 'organizations', permission: 'public', public: true, params: [tokenParam('slug', 'Public organisation slug.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('PublicOrganizationProfile')) } }) },
  '/impact': { get: operation({ id: 'getImpact', summary: 'Platform figures with their definitions, and an explicit list of figures no module can yet produce.', tag: 'projects', permission: 'public', public: true, success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('ImpactSummary')) } }) },

  '/me/bookmarks': { get: operation({ id: 'listBookmarks', summary: 'What the signed-in person saved. One list, two kinds of target, and each row names its kind so a screen never has to guess which field to read.', tag: 'identity', permission: 'self', success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'array', items: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, kind: { type: 'string', enum: ['project', 'program'] }, createdAt: { type: 'string', format: 'date-time' }, project: { anyOf: [ref('PublicProjectCard'), { type: 'null' }] }, program: { anyOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }] } } } }) } }) },
  '/bookmarks': { post: operation({ id: 'addBookmark', summary: 'Save a visible project or programme. Exactly one target; saving twice is idempotent; and saving deliberately creates no application.', tag: 'identity', permission: 'self', body: { type: 'object', additionalProperties: false, properties: { projectSlug: { type: 'string', maxLength: 120 }, programSlug: { type: 'string', maxLength: 120, description: 'PART-10. Exactly one of the two slugs: a bookmark pointing at nothing, or at two things, is one nobody could render.' } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { id: { type: 'string', format: 'uuid' }, kind: { type: 'string', enum: ['project', 'program'] }, status: { type: 'string', enum: ['saved'] }, createsApplication: { type: 'boolean', const: false, description: 'Said in the reply, because a saved opportunity that quietly became an application is a trap.' } } }) } }) },
  '/bookmarks/{id}': { delete: operation({ id: 'removeBookmark', summary: 'Remove an owned bookmark. Another person’s bookmark is reported absent.', tag: 'identity', permission: 'self', params: [uuidParam('id', 'Bookmark identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { id: { type: 'string', format: 'uuid' }, status: { type: 'string', enum: ['removed'] } } }) } }) },

  '/orgs/{id}/projects': {
    get: operation({ id: 'listOrganizationProjects', summary: 'Projects owned by the organisation, including drafts.', tag: 'projects', permission: 'project.read', params: [uuidParam('id', 'Organisation identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'array', items: ref('OrganizationProjectRow') }) } }),
    post: operation({ id: 'createProject', summary: 'Create a project draft. The type is chosen once and fixed at publication.', tag: 'projects', permission: 'project.create', params: [uuidParam('id', 'Organisation identifier.')], body: ref('ProjectInput'), success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('OrganizationProjectRow')) } })
  },
  '/orgs/{id}/projects/{projectId}': {
    get: operation({ id: 'getOrganizationProject', summary: 'Read one project inside the organisation. An identifier from another tenant returns 404.', tag: 'projects', permission: 'project.read', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('projectId', 'Project identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('OrganizationProjectRow')) } }),
    patch: operation({ id: 'updateProject', summary: 'Edit a draft. A project under review is frozen because a reviewer is reading its snapshot.', tag: 'projects', permission: 'project.update', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('projectId', 'Project identifier.')], body: { allOf: [ref('ProjectInput'), { type: 'object', required: ['version'], properties: { version: { type: 'integer', minimum: 1 } } }] }, success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('OrganizationProjectRow')) } })
  },
  '/orgs/{id}/projects/{projectId}/public-preview': { get: operation({ id: 'previewProjectPublicly', summary: 'Exactly what a visitor would see, without publishing anything.', tag: 'projects', permission: 'project.read', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('projectId', 'Project identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { preview: ref('PublicProjectDetail'), wouldBeVisible: { type: 'boolean' } } }) } }) },
  '/orgs/{id}/projects/{projectId}/submit': { post: operation({ id: 'submitProject', summary: 'Lock an immutable snapshot for review. Requires a complete summary and a verified organisation.', tag: 'projects', permission: 'project.submit', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('projectId', 'Project identifier.')], body: versionBody('Project version.'), success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { id: { type: 'string', format: 'uuid' }, sequence: { type: 'integer' }, state: { type: 'string', enum: ['submitted'] }, submittedAt: { type: 'string', format: 'date-time' } } }) } }) },
  '/orgs/{id}/projects/{projectId}/duplicate': { post: operation({ id: 'duplicateProject', summary: 'Copy a project as a new draft. Money, contributors and approvals are never copied.', tag: 'projects', permission: 'project.create', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('projectId', 'Project identifier.')], success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('OrganizationProjectRow')) } }) },

  // ---- PART-05: the charity lifecycle from budgeted draft to reviewed publication --------------
  '/orgs/{id}/projects/{projectId}/plan': { get: operation({ id: 'getProjectPlan', summary: 'Campaign, budget, milestones, revision history and the reasons a submission is blocked.', tag: 'charity', permission: 'project.read', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('projectId', 'Project identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('ProjectPlan')) } }) },
  '/orgs/{id}/projects/{projectId}/campaign': { put: operation({ id: 'saveCampaign', summary: 'Set the goal, currency, funding policy and end date. Policy and currency are fixed once published.', tag: 'charity', permission: 'project.update', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('projectId', 'Project identifier.')], body: ref('CampaignInput'), success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('Campaign')) } }) },
  '/orgs/{id}/projects/{projectId}/budget': { put: operation({ id: 'reviseBudget', summary: 'Replace the budget. The previous state is written to an append-only revision first, never overwritten.', tag: 'charity', permission: 'project.update', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('projectId', 'Project identifier.')], body: ref('BudgetInput'), success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { totalMinor: ref('MinorAmount'), lineCount: { type: 'integer' } } }) } }) },
  '/orgs/{id}/projects/{projectId}/milestones': { put: operation({ id: 'saveMilestones', summary: 'Replace the milestone plan. Weights must total 100, and a milestone carrying evidence cannot be replaced.', tag: 'charity', permission: 'project.update', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('projectId', 'Project identifier.')], body: ref('MilestonesInput'), success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { count: { type: 'integer' }, totalMinor: ref('MinorAmount') } }) } }) },

  '/orgs/{id}/projects/{projectId}/pause': { post: operation({ id: 'pauseProject', summary: 'Stop new contributions with a stated reason. Money already committed is unaffected.', tag: 'charity', permission: 'project.pause', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('projectId', 'Project identifier.')], body: ref('ReasonedVersion'), success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('ProjectStateResult')) } }) },
  '/orgs/{id}/projects/{projectId}/resume': { post: operation({ id: 'resumeProject', summary: 'Return a paused project to published.', tag: 'charity', permission: 'project.pause', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('projectId', 'Project identifier.')], body: versionBody('Project version.'), success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('ProjectStateResult')) } }) },
  '/orgs/{id}/projects/{projectId}/close': { post: operation({ id: 'requestProjectClose', summary: 'Request closure. This moves to impact review; it does not complete the project.', tag: 'charity', permission: 'project.close', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('projectId', 'Project identifier.')], body: ref('ReasonedVersion'), success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ allOf: [ref('ProjectStateResult'), { type: 'object', properties: { completed: { type: 'boolean', description: 'Always false: closure is requested, not self-declared.' } } }] }) } }) },
  '/orgs/{id}/projects/{projectId}/milestones/{milestoneId}/evidence': { post: operation({ id: 'submitMilestoneEvidence', summary: 'Submit delivery evidence for a milestone. The organisation cannot verify its own milestone.', tag: 'charity', permission: 'project.update', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('projectId', 'Project identifier.'), uuidParam('milestoneId', 'Milestone identifier.')], body: { type: 'object', required: ['note'], additionalProperties: false, properties: { note: { type: 'string', minLength: 10, maxLength: 2000 } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { id: { type: 'string', format: 'uuid' }, state: ref('MilestoneState'), evidenceSubmittedAt: { type: ['string', 'null'], format: 'date-time' } } }) } }) },
  '/orgs/{id}/projects/{projectId}/updates': { post: operation({ id: 'publishProjectUpdate', summary: 'Publish a public update on a published project.', tag: 'charity', permission: 'report.publish', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('projectId', 'Project identifier.')], body: { type: 'object', required: ['title', 'body'], additionalProperties: false, properties: { title: { type: 'string', minLength: 5, maxLength: 140 }, body: { type: 'string', minLength: 20, maxLength: 20000 } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { id: { type: 'string', format: 'uuid' }, publishedAt: { type: 'string', format: 'date-time' } } }) } }) },

  '/orgs/{id}/projects/{projectId}/report-metrics': { get: operation({ id: 'getReportMetrics', summary: 'Figures a report may state, each with its definition, plus the figures no module can yet produce.', tag: 'charity', permission: 'report.create', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('projectId', 'Project identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('ReportMetrics')) } }) },
  '/orgs/{id}/projects/{projectId}/reports': { post: operation({ id: 'createReport', summary: 'Create a report draft for a period.', tag: 'charity', permission: 'report.create', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('projectId', 'Project identifier.')], body: { type: 'object', required: ['title', 'periodStart', 'periodEnd', 'body'], additionalProperties: false, properties: { title: { type: 'string', minLength: 5, maxLength: 140 }, periodStart: { type: 'string', format: 'date' }, periodEnd: { type: 'string', format: 'date' }, body: { type: 'string', maxLength: 40000 } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('ProjectReport')) } }) },
  '/orgs/{id}/reports/{reportId}/submit': { post: operation({ id: 'submitReport', summary: 'Send a report draft for internal review.', tag: 'charity', permission: 'report.submit', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('reportId', 'Report identifier.')], body: versionBody('Report version.'), success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('ProjectReport')) } }) },
  '/orgs/{id}/reports/{reportId}/publish': { post: operation({ id: 'publishReport', summary: 'Publish a reviewed report as a frozen snapshot. The author may not publish their own report.', tag: 'charity', permission: 'report.publish', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('reportId', 'Report identifier.')], body: versionBody('Report version.'), success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('ProjectReport')) } }) },

  '/admin/reviews/project': { get: operation({ id: 'listProjectReviewQueue', summary: 'Submitted projects awaiting content review.', tag: 'admin', permission: 'ContentReviewer grant with MFA', success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'array', items: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, sequence: { type: 'integer' }, submittedAt: { type: 'string', format: 'date-time' } } } }) } }) },
  '/admin/reviews/project/{versionId}': { get: operation({ id: 'getProjectReview', summary: 'Read a submitted version with its plan. A submission claimed by another reviewer returns 404.', tag: 'admin', permission: 'ContentReviewer grant with MFA', params: [uuidParam('versionId', 'Submitted project version identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', additionalProperties: true }) } }) },
  '/admin/reviews/project/{versionId}/claim': { post: operation({ id: 'claimProjectReview', summary: 'Claim a submission atomically so two reviewers cannot decide the same one.', tag: 'admin', permission: 'ContentReviewer grant with MFA', params: [uuidParam('versionId', 'Submitted project version identifier.')], success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { versionId: { type: 'string', format: 'uuid' }, state: ref('ProjectState'), version: { type: 'integer' } } }) } }) },
  '/admin/tasks/{id}/assign': { post: operation({ id: 'assignReviewTask', summary: 'ADM-01.A03. An MFA-enabled PlatformAdmin transfers a live project review to an active MFA-enabled ContentReviewer at one optimistic project version.', tag: 'admin', permission: 'review.assign', params: [uuidParam('id', 'Submitted project version task.')], body: { type: 'object', required: ['assigneeId', 'version'], additionalProperties: false, properties: { assigneeId: { type: 'string', format: 'uuid' }, version: { type: 'integer', minimum: 1 } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', additionalProperties: true }) } }) },
  '/admin/reviews/project/{versionId}/decision': { post: operation({ id: 'decideProjectReview', summary: 'Approve, request changes or reject. Append-only, and refused for anyone who is a member of the owning organisation.', tag: 'admin', permission: 'ContentReviewer grant with MFA', params: [uuidParam('versionId', 'Submitted project version identifier.')], body: { type: 'object', required: ['outcome', 'publicReason', 'version'], additionalProperties: false, properties: { outcome: ref('ReviewOutcome'), publicReason: { type: 'string', maxLength: 1000, description: 'At least 10 characters unless the outcome is approved.' }, version: { type: 'integer', minimum: 1 } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { id: { type: 'string', format: 'uuid' }, outcome: ref('ReviewOutcome'), publicReason: { type: 'string' }, decidedAt: { type: 'string', format: 'date-time' }, state: ref('ProjectState') } }) } }) },
  '/admin/projects/{projectId}/publish': { post: operation({ id: 'publishProject', summary: 'Publish an approved project. Re-checks verification and plan completeness, because verification can lapse between approval and publication.', tag: 'admin', permission: 'ContentReviewer grant with MFA', params: [uuidParam('projectId', 'Project identifier.')], body: versionBody('Project version.'), success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { id: { type: 'string', format: 'uuid' }, slug: { type: 'string' }, state: ref('ProjectState'), publishedAt: { type: 'string', format: 'date-time' } } }) } }) },

  // ---- PART-06: contributions, the simulated payment path and the ledger -----------------------
  '/projects/{slug}/contributors': { get: operation({ id: 'listPublicContributors', summary: 'Public contributor list. A name appears only where the contributor chose to be named, and an amount only where they separately consented.', tag: 'money', permission: 'public', public: true, params: [tokenParam('slug', 'Public project slug.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'array', items: ref('PublicContributor') }) } }) },
  '/projects/{slug}/quote': { get: operation({ id: 'quoteContribution', summary: 'What the payer will be charged, the fee, and what reaches the project. Recalculated server side at submission.', tag: 'money', permission: 'public', public: true, params: [tokenParam('slug', 'Public project slug.')], query: [{ name: 'amountMinor', description: 'Integer minor units as a decimal string.', required: true }], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('ContributionQuote')) } }) },

  '/contributions': { post: operation({ id: 'createContribution', summary: 'Start a contribution. Reserves capacity and opens a payment intent; it is not a payment.', tag: 'money', permission: 'self', headers: [{ name: 'Idempotency-Key', description: 'Required. The same key with the same body returns the original result; a different body is a conflict.' }], body: ref('ContributionInput'), success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('CreatedContribution')) } }) },
  '/me/contributions': { get: operation({ id: 'listMyContributions', summary: 'The contributor’s own record, which always shows their own identity and amounts to them.', tag: 'money', permission: 'self', success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'array', items: ref('MyContribution') }) } }) },
  '/me/contributions/{id}/privacy': { patch: operation({ id: 'updateContributionPrivacy', summary: 'Change public visibility. Takes effect in every public projection immediately, because none is cached.', tag: 'money', permission: 'self', params: [uuidParam('id', 'Contribution identifier.')], body: { type: 'object', required: ['visibility', 'showAmountPublicly', 'version'], additionalProperties: false, properties: { visibility: ref('ContributionVisibility'), showAmountPublicly: { type: 'boolean', description: 'Ignored while anonymous: an anonymous amount is not published.' }, version: { type: 'integer', minimum: 1 } } }, success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { id: { type: 'string', format: 'uuid' }, visibility: ref('ContributionVisibility'), showAmountPublicly: { type: 'boolean' }, version: { type: 'integer' } } }) } }) },
  '/payment-intents/{id}/status': { get: operation({ id: 'getPaymentIntentStatus', summary: 'Authoritative payment status, read from our own record rather than from a query parameter.', tag: 'money', permission: 'self', params: [uuidParam('id', 'Payment intent identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('PaymentIntentStatus')) } }) },

  '/orgs/{id}/projects/{projectId}/finance': { get: operation({ id: 'getProjectFinance', summary: 'Balances derived from the ledger, the journal, and a contributor list without identities.', tag: 'money', permission: 'finance.read', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('projectId', 'Project identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('ProjectFinance')) } }) },

  '/webhooks/payments/simulator': { post: operation({ id: 'receivePaymentWebhook', summary: 'Provider events. Authenticated by a signature over the raw body, not by a session; a duplicate event id is acknowledged without reprocessing.', tag: 'money', permission: 'provider signature', public: true, headers: [{ name: 'x-provider-signature', description: 'HMAC-SHA256 over `timestamp.rawBody`.' }, { name: 'x-provider-timestamp', description: 'Unix milliseconds; events outside a five-minute window are refused.' }], body: ref('ProviderEvent'), success: { status: 200, description: 'Acknowledged once durably recorded. The body states what was done with it.', schema: envelope({ type: 'object', properties: { status: { type: 'string', enum: ['succeeded', 'failed', 'duplicate', 'stale_event', 'already_final', 'already_posted', 'amount_mismatch', 'unknown_reference'] } } }) } }) },
  '/payments/simulate/{providerReference}': { post: operation({ id: 'simulatePayment', summary: 'Demo-only. Signs an event and feeds it through the real webhook path, because there is no gateway in this build.', tag: 'money', permission: 'self (demo/test only)', params: [tokenParam('providerReference', 'Provider reference from the created intent.')], body: { type: 'object', required: ['outcome'], additionalProperties: false, properties: { outcome: { type: 'string', enum: ['succeeded', 'failed', 'settled'], description: '`settled` is a separate, later event, not something `succeeded` implies: 08 requires that receiving money and being able to spend it stay distinct, and a real provider reports settlement hours or days afterwards.' } } }, success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { status: { type: 'string' }, paymentIntentId: { type: 'string', format: 'uuid', description: 'Returned so the page can send the payer to the result screen, as a provider redirect would.' } } }) } }) },

  // ---- PART-07: payouts, refunds, disputes and reconciliation ---------------------------------
  // The organisation asks and approves; the platform executes. Neither can do the other's half,
  // which is why the two sit on different route prefixes.
  '/orgs/{id}/payouts': {
    get: operation({ id: 'listPayouts', summary: 'Disbursements for one organisation, newest first.', tag: 'money', permission: 'finance.read', params: [uuidParam('id', 'Organisation identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'array', items: ref('Payout') }) } }),
    post: operation({ id: 'requestPayout', summary: 'Request a disbursement. Reserves the money immediately, so two requests cannot be raised against the same balance.', tag: 'money', permission: 'payout.request', params: [uuidParam('id', 'Organisation identifier.')], body: ref('PayoutInput'), success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('Payout')) } })
  },
  '/payouts/{id}': { get: operation({ id: 'getPayout', summary: 'One disbursement with its append-only decision history.', tag: 'money', permission: 'finance.read, or a FinanceOperator grant', params: [uuidParam('id', 'Payout identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('PayoutDetail')) } }) },
  '/payouts/{id}/approve': { post: operation({ id: 'approvePayout', summary: 'Approve a disbursement. A different person, with MFA, agreeing to the exact request they were shown.', tag: 'money', permission: 'payout.approve (never the maker)', params: [uuidParam('id', 'Payout identifier.')], body: { type: 'object', required: ['requestHash', 'version'], additionalProperties: false, properties: { requestHash: { type: 'string', pattern: '^[0-9a-f]{64}$', description: 'The hash shown to the approver. A stale value is a 409: the request has changed since.' }, version: { type: 'integer', minimum: 1 } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('Payout')) } }) },
  '/payouts/{id}/reject': { post: operation({ id: 'rejectPayout', summary: 'Reject a disbursement, releasing its reservation back to the pool.', tag: 'money', permission: 'payout.approve (never the maker)', params: [uuidParam('id', 'Payout identifier.')], body: { type: 'object', required: ['reason', 'version'], additionalProperties: false, properties: { reason: { type: 'string', minLength: 10, maxLength: 1000 }, version: { type: 'integer', minimum: 1 } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('Payout')) } }) },
  '/payouts/{id}/withdraw': { post: operation({ id: 'withdrawPayout', summary: 'The maker withdraws their own request, which is refused once the instruction has left for the provider.', tag: 'money', permission: 'payout.request', params: [uuidParam('id', 'Payout identifier.')], body: versionBody('Payout version.'), success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('Payout')) } }) },

  '/contributions/{id}/refunds': { get: operation({ id: 'listRefunds', summary: 'Refunds on one contribution, with what is still refundable and what the fee would cost.', tag: 'money', permission: 'self (the contributor), or finance.read', params: [uuidParam('id', 'Contribution identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('RefundList')) } }) },
  '/contributions/{id}/refund-requests': { post: operation({ id: 'requestRefund', summary: 'Request a refund. Never exceeds what is left after confirmed refunds and pending reservations.', tag: 'money', permission: 'self (the contributor), or refund.request', params: [uuidParam('id', 'Contribution identifier.')], body: { type: 'object', required: ['amountMinor', 'reason'], additionalProperties: false, properties: { amountMinor: ref('MinorUnits'), reason: { type: 'string', minLength: 10, maxLength: 1000 }, feeCoveredByPool: { type: 'boolean', description: 'Who funds the processor fee on a full refund. Decided before execution, not discovered during it.' } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('Refund')) } }) },
  '/refunds/{id}/approve': { post: operation({ id: 'approveRefund', summary: 'Approve a refund, which reserves the cash. Refused when the pool cannot actually fund it.', tag: 'money', permission: 'refund.approve (never the requester), or a FinanceOperator grant', params: [uuidParam('id', 'Refund identifier.')], body: versionBody('Refund version.'), success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('Refund')) } }) },
  '/refunds/{id}/reject': { post: operation({ id: 'rejectRefund', summary: 'Reject a refund request with a reason.', tag: 'money', permission: 'refund.approve (never the requester), or a FinanceOperator grant', params: [uuidParam('id', 'Refund identifier.')], body: { type: 'object', required: ['reason', 'version'], additionalProperties: false, properties: { reason: { type: 'string', minLength: 10, maxLength: 1000 }, version: { type: 'integer', minimum: 1 } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('Refund')) } }) },

  '/admin/finance': { get: operation({ id: 'getFinanceCentre', summary: 'ADM-05. Reconciliation state, the disbursement queue, and everything waiting on a provider answer.', tag: 'admin', permission: 'FinanceOperator grant with MFA', success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('FinanceCentre')) } }) },
  '/admin/reconciliation/imports': { post: operation({ id: 'importStatement', summary: 'Import a provider statement. The same file cannot be imported twice into the same environment.', tag: 'admin', permission: 'FinanceOperator grant with MFA', body: { type: 'object', required: ['source', 'statementDate', 'rows'], additionalProperties: false, properties: { source: { type: 'string', maxLength: 40 }, statementDate: { type: 'string', format: 'date-time' }, rows: { type: 'array', minItems: 1, maxItems: 5000, items: ref('StatementRow') } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { id: { type: 'string', format: 'uuid' }, source: { type: 'string' }, environment: { type: 'string' }, fileHash: { type: 'string' }, rowCount: { type: 'integer' }, duplicateRowsInFile: { type: 'integer' }, state: { type: 'string' }, version: { type: 'integer' } } }) } }) },
  '/admin/reconciliation/{id}': { get: operation({ id: 'getReconciliationBatch', summary: 'One imported statement with every line and its verdict.', tag: 'admin', permission: 'FinanceOperator grant with MFA', params: [uuidParam('id', 'Reconciliation batch identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('ReconciliationBatch')) } }) },
  '/admin/reconciliation/{id}/run': { post: operation({ id: 'runReconciliation', summary: 'Match every line against our own record. Writes no ledger entries, so re-running cannot double-count.', tag: 'admin', permission: 'FinanceOperator grant with MFA', params: [uuidParam('id', 'Reconciliation batch identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { id: { type: 'string', format: 'uuid' }, state: { type: 'string' }, lastRunAt: { type: 'string', format: 'date-time' }, counts: { type: 'object', properties: { match: { type: 'integer' }, mismatch: { type: 'integer' }, missing: { type: 'integer' }, duplicate: { type: 'integer' } } }, version: { type: 'integer' } } }) } }) },
  '/admin/reconciliation/items/{id}/resolutions': { post: operation({ id: 'resolveReconciliationItem', summary: 'Close one difference with a signed explanation. It changes no figure: a correction to the books is a separate, approved ledger entry.', tag: 'admin', permission: 'FinanceOperator grant with MFA', params: [uuidParam('id', 'Reconciliation item identifier.')], body: { type: 'object', required: ['reason', 'version'], additionalProperties: false, properties: { reason: { type: 'string', minLength: 10, maxLength: 1000 }, version: { type: 'integer', minimum: 1 } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('ReconciliationItem')) } }) },

  '/admin/payouts/{id}/execute': { post: operation({ id: 'executePayout', summary: 'Send an approved disbursement to the provider. Re-checks suspension, verification, the beneficiary and the reservation, because time has passed since approval.', tag: 'admin', permission: 'FinanceOperator grant with MFA', params: [uuidParam('id', 'Payout identifier.')], body: versionBody('Payout version.'), success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('Payout')) } }) },
  '/admin/payouts/{id}/inquire': { post: operation({ id: 'inquirePayout', summary: 'Ask the provider what happened. The only way out of `unknown`: re-sending an instruction whose outcome we do not know would pay twice.', tag: 'admin', permission: 'FinanceOperator grant with MFA', params: [uuidParam('id', 'Payout identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { status: { type: 'string', enum: ['paid', 'failed', 'unknown', 'still_pending', 'already_final'] }, payout: ref('Payout') } }) } }) },
  '/admin/refunds/{id}/execute': { post: operation({ id: 'executeRefund', summary: 'Send an approved refund to the provider, back to the original payment.', tag: 'admin', permission: 'FinanceOperator grant with MFA', params: [uuidParam('id', 'Refund identifier.')], body: versionBody('Refund version.'), success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('Refund')) } }) },
  '/admin/refunds/{id}/inquire': { post: operation({ id: 'inquireRefund', summary: 'Ask the provider what happened to a refund we lost track of.', tag: 'admin', permission: 'FinanceOperator grant with MFA', params: [uuidParam('id', 'Refund identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { status: { type: 'string' }, refund: ref('Refund') } }) } }) },
  '/admin/contributions/{id}/disputes': { post: operation({ id: 'openDispute', summary: 'Record a chargeback. The original payment is not rewritten, and a shortfall is carried openly rather than clamped to zero.', tag: 'admin', permission: 'FinanceOperator grant with MFA', params: [uuidParam('id', 'Contribution identifier.')], body: { type: 'object', required: ['amountMinor', 'reason'], additionalProperties: false, properties: { amountMinor: ref('MinorUnits'), reason: { type: 'string', minLength: 10, maxLength: 1000 }, coveragePlan: { type: 'string', maxLength: 2000 } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('Dispute')) } }) },
  '/admin/disputes/{id}/resolve': { post: operation({ id: 'resolveDispute', summary: 'Settle a chargeback. Losing it takes the money and may leave the pool short, which is reported rather than hidden.', tag: 'admin', permission: 'FinanceOperator grant with MFA', params: [uuidParam('id', 'Dispute identifier.')], body: { type: 'object', required: ['outcome', 'reason', 'version'], additionalProperties: false, properties: { outcome: { type: 'string', enum: ['lost', 'won', 'withdrawn'] }, reason: { type: 'string', minLength: 10, maxLength: 1000 }, version: { type: 'integer', minimum: 1 } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('Dispute')) } }) },

  '/payments/simulate/payout/{id}': { post: operation({ id: 'simulatePayoutOutcome', summary: 'Demo-only. Decides what reached us and, separately, what the simulated provider itself believes — which is what makes an inquiry a real check.', tag: 'money', permission: 'self (demo/test only)', params: [uuidParam('id', 'Payout identifier.')], body: { type: 'object', required: ['outcome'], additionalProperties: false, properties: { outcome: { type: 'string', enum: ['paid', 'failed', 'unknown'] }, tellProvider: { type: 'string', enum: ['paid', 'failed', 'pending'], description: 'What the provider will answer on inquiry. Defaults to matching the outcome; set it differently to stage a timeout over a success.' } } }, success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { status: { type: 'string' }, payout: ref('Payout') } }) } }) },
  '/payments/simulate/refund/{id}': { post: operation({ id: 'simulateRefundOutcome', summary: 'Demo-only. The same for a refund.', tag: 'money', permission: 'self (demo/test only)', params: [uuidParam('id', 'Refund identifier.')], body: { type: 'object', required: ['outcome'], additionalProperties: false, properties: { outcome: { type: 'string', enum: ['succeeded', 'failed', 'unknown'] }, tellProvider: { type: 'string', enum: ['succeeded', 'failed', 'pending'] } } }, success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { status: { type: 'string' }, refund: ref('Refund') } }) } }) },

  // ---- PART-08: ventures, offerings, eligibility and the data room ------------------------------
  // `/offerings/...` is what an investor reaches, `/orgs/...` is the issuer running its own
  // offering, and `/admin/...` is the independent reviewer. Nothing here takes money.
  '/offerings': { get: operation({ id: 'browseOfferings', summary: 'PUB-07. Offerings open to the public. Anything before `open` is absent, not forbidden.', tag: 'investment', permission: 'public', public: true, query: [{ name: 'cursor', description: 'Opaque cursor from the previous page.' }, { name: 'limit', description: 'Page size, 1-100, default 20.' }], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'array', items: ref('PublicOffering') }) } }) },
  '/offerings/{slug}': { get: operation({ id: 'getPublicOffering', summary: 'PUB-08. The public offering with its current disclosure. No projected return and no valuation appear anywhere in it.', tag: 'investment', permission: 'public', public: true, params: [tokenParam('slug', 'Public offering slug.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('PublicOffering')) } }) },
  '/offerings/{slug}/quote': { get: operation({ id: 'quoteSubscription', summary: 'What an amount would buy: whole shares only, with the remainder and both percentages stated separately.', tag: 'investment', permission: 'public', public: true, params: [tokenParam('slug', 'Public offering slug.')], query: [{ name: 'amountMinor', description: 'Integer minor units as a decimal string.', required: true }], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('SubscriptionQuote')) } }) },
  '/offerings/{slug}/interests': { post: operation({ id: 'registerInterest', summary: 'PUB-08.A01. Registers interest. 06 is explicit that this reserves no capacity and is not funding, and the response says so.', tag: 'investment', permission: 'self', params: [tokenParam('slug', 'Public offering slug.')], body: { type: 'object', additionalProperties: false, properties: { indicativeAmountMinor: { anyOf: [ref('MinorUnits'), { type: 'null' }] } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { id: { type: 'string', format: 'uuid' }, indicativeAmountMinor: { anyOf: [ref('MinorUnits'), { type: 'null' }] }, reservesCapacity: { type: 'boolean', const: false }, isFunding: { type: 'boolean', const: false } } }) } }) },

  '/me/investor-eligibility': {
    get: operation({ id: 'getMyEligibility', summary: 'PER-07. The person’s own eligibility, with whether they chose the capability reported separately from whether they are eligible.', tag: 'investment', permission: 'self', success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('InvestorEligibility')) } }),
    patch: operation({ id: 'saveEligibilityDraft', summary: 'PER-07.A01. Saves a draft. Nothing is sent for review.', tag: 'investment', permission: 'self', body: ref('EligibilityAnswers'), success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { state: ref('EligibilityState'), version: { type: 'integer' }, saved: { type: 'boolean' } } }) } })
  },
  '/me/investor-eligibility/submissions': { post: operation({ id: 'submitEligibility', summary: 'PER-07.A02/A03. Submits an immutable snapshot for review. Submitting is a claim, never an approval.', tag: 'investment', permission: 'self', body: ref('EligibilityAnswers'), success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { state: ref('EligibilityState'), version: { type: 'integer' }, submissionId: { type: 'string', format: 'uuid' }, sequence: { type: 'integer' } } }) } }) },

  '/offerings/{id}/dataroom': { get: operation({ id: 'readDataRoom', summary: 'The data room as this reader may see it. Access is re-derived per offering on every read; nothing is inherited or cached.', tag: 'investment', permission: 'self (public documents), dataroom grant or NDA acceptance for the rest', params: [uuidParam('id', 'Offering identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('DataRoom')) } }) },
  '/dataroom-documents/{id}/download': { get: operation({ id: 'downloadDataRoomDocument', summary: 'PER-09.A03. Serves only a clean file after re-checking its current classification and records every successful download.', tag: 'investment', permission: 'classification-specific data-room access, or offering.manage', params: [uuidParam('id', 'Document identifier.')], success: { status: 200, description: 'The verified document bytes.' } }) },
  '/offerings/{id}/access-requests': { post: operation({ id: 'requestDataRoomAccess', summary: 'PUB-08.A02. Asks to enter one offering’s data room.', tag: 'investment', permission: 'self', params: [uuidParam('id', 'Offering identifier.')], body: { type: 'object', required: ['reason'], additionalProperties: false, properties: { reason: { type: 'string', minLength: 10, maxLength: 1000 } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { id: { type: 'string', format: 'uuid' }, state: { type: 'string' }, version: { type: 'integer' } } }) } }) },
  '/offerings/{id}/nda-acceptances': {
    get: operation({ id: 'listMyNdaAcceptances', summary: 'Every version this person accepted. Kept whatever the offering publishes afterwards.', tag: 'investment', permission: 'self', params: [uuidParam('id', 'Offering identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'array', items: ref('NdaAcceptance') }) } }),
    post: operation({ id: 'acceptNda', summary: 'Accepts the disclosure as it currently stands. A stale id or checksum is a 409: the text changed while it was being read.', tag: 'investment', permission: 'self', params: [uuidParam('id', 'Offering identifier.')], body: { type: 'object', required: ['disclosureId', 'checksum'], additionalProperties: false, properties: { disclosureId: { type: 'string', format: 'uuid' }, checksum: { type: 'string', pattern: '^[0-9a-f]{64}$' } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('NdaAcceptance')) } })
  },
  '/offerings/{id}/questions': {
    get: operation({ id: 'listInvestorQuestions', summary: 'An investor sees only their own questions; the issuer sees all of them for its own offering.', tag: 'investment', permission: 'self, or offering.manage for the issuer', params: [uuidParam('id', 'Offering identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'array', items: ref('InvestorQuestion') }) } }),
    post: operation({ id: 'askInvestorQuestion', summary: 'PUB-08.A05. Asks the issuer privately. Needs data room access.', tag: 'investment', permission: 'dataroom.read (a live grant or a current NDA acceptance)', params: [uuidParam('id', 'Offering identifier.')], body: { type: 'object', required: ['body'], additionalProperties: false, properties: { body: { type: 'string', minLength: 10, maxLength: 2000 } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { id: { type: 'string', format: 'uuid' }, body: { type: 'string' }, createdAt: { type: 'string', format: 'date-time' } } }) } })
  },
  '/investor-questions/{id}/replies': { post: operation({ id: 'replyToInvestorQuestion', summary: 'BUS-03.A04. The issuer answers one investor. Never a broadcast, and never revealing another investor.', tag: 'investment', permission: 'offering.manage', params: [uuidParam('id', 'Question identifier.')], body: { type: 'object', required: ['body'], additionalProperties: false, properties: { body: { type: 'string', minLength: 10, maxLength: 4000 } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { id: { type: 'string', format: 'uuid' }, body: { type: 'string' }, createdAt: { type: 'string', format: 'date-time' } } }) } }) },

  '/orgs/{id}/venture': {
    get: operation({ id: 'getVenture', summary: 'The venture behind this organisation’s offerings, or null when none has been created.', tag: 'investment', permission: 'organization.read', params: [uuidParam('id', 'Organisation identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ anyOf: [ref('Venture'), { type: 'null' }] }) } }),
    put: operation({ id: 'saveVenture', summary: 'Creates or updates the venture. The share count cannot change while an offering is live, because every percentage already quoted depends on it.', tag: 'investment', permission: 'offering.manage', params: [uuidParam('id', 'Organisation identifier.')], body: { type: 'object', required: ['legalName', 'summary', 'currentShares', 'currency'], additionalProperties: false, properties: { legalName: { type: 'string', minLength: 2, maxLength: 200 }, summary: { type: 'string', minLength: 30, maxLength: 2000 }, currentShares: ref('ShareCount'), currency: { type: 'string', pattern: '^[A-Za-z]{3}$' }, version: { type: 'integer', minimum: 1 } } }, success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('Venture')) } })
  },
  '/orgs/{id}/offerings': {
    get: operation({ id: 'listOfferings', summary: 'BUS-01. The issuer’s own offerings, including drafts nobody else can see.', tag: 'investment', permission: 'organization.read', params: [uuidParam('id', 'Organisation identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'array', items: ref('Offering') }) } }),
    post: operation({ id: 'createOffering', summary: 'BUS-02.A01. A draft offering. Needs a venture and a verified organisation.', tag: 'investment', permission: 'offering.manage', params: [uuidParam('id', 'Organisation identifier.')], body: ref('OfferingInput'), success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('Offering')) } })
  },
  '/orgs/{id}/offerings/{oid}': {
    get: operation({ id: 'getOffering', summary: 'BUS-02. One offering with its disclosure history and review decisions.', tag: 'investment', permission: 'organization.read', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('oid', 'Offering identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('Offering')) } }),
    patch: operation({ id: 'updateOffering', summary: 'BUS-02.A01. Editing is refused once a reviewer holds it: they are judging the version that was sent.', tag: 'investment', permission: 'offering.manage', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('oid', 'Offering identifier.')], body: ref('OfferingInput'), success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('Offering')) } })
  },
  '/orgs/{id}/offerings/{oid}/validate': { post: operation({ id: 'validateOffering', summary: 'BUS-02.A02. Checks the numbers without changing anything, so the editor can show what is wrong before it is committed to.', tag: 'investment', permission: 'offering.manage', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('oid', 'Offering identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('OfferingTermsCheck')) } }) },
  '/orgs/{id}/offerings/{oid}/disclosure-revisions': { post: operation({ id: 'publishDisclosure', summary: 'BUS-02.A04. A new, numbered disclosure. The previous one is never edited, and a material revision suspends an open offering.', tag: 'investment', permission: 'offering.manage', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('oid', 'Offering identifier.')], body: { type: 'object', required: ['summary', 'risks', 'useOfFunds', 'version'], additionalProperties: false, properties: { summary: { type: 'string', minLength: 50, maxLength: 4000 }, risks: { type: 'string', minLength: 20, maxLength: 6000 }, useOfFunds: { type: 'string', minLength: 20, maxLength: 4000 }, material: { type: 'boolean' }, reason: { type: 'string', maxLength: 1000, description: 'Required once the offering has left draft, because someone already judged the old text.' }, version: { type: 'integer', minimum: 1 } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { disclosure: ref('OfferingDisclosure'), offering: ref('Offering') } }) } }) },
  '/orgs/{id}/offerings/{oid}/submit': { post: operation({ id: 'submitOffering', summary: 'BUS-02.A03. Sends it to an independent reviewer and freezes it. An incomplete offering is refused here rather than wasting a reviewer’s time.', tag: 'investment', permission: 'offering.manage', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('oid', 'Offering identifier.')], body: versionBody('Offering version.'), success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('Offering')) } }) },
  '/orgs/{id}/offerings/{oid}/open': { post: operation({ id: 'openOffering', summary: 'Opens an approved offering. Re-checks verification and that the approval was for the disclosure now in force.', tag: 'investment', permission: 'offering.manage', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('oid', 'Offering identifier.')], body: versionBody('Offering version.'), success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('Offering')) } }) },
  '/orgs/{id}/offerings/{oid}/close': { post: operation({ id: 'closeOffering', summary: 'BUS-01.A03. Stops new money and moves the offering to `closing`. It allocates nothing: allocation is computed, submitted and independently approved as separate steps.', tag: 'investment', permission: 'offering.manage', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('oid', 'Offering identifier.')], body: versionBody('Offering version.'), success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('Offering')) } }) },
  '/orgs/{id}/offerings/{oid}/documents': { post: operation({ id: 'addDataRoomDocument', summary: 'BUS-03.A01. Files a document with a category, a classification and a checksum. A replacement supersedes rather than overwrites.', tag: 'investment', permission: 'offering.manage', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('oid', 'Offering identifier.')], body: { type: 'object', required: ['title', 'category', 'classification', 'checksum', 'byteSize', 'contentType'], additionalProperties: false, properties: { title: { type: 'string', minLength: 2, maxLength: 200 }, category: ref('DataRoomCategory'), classification: ref('DataRoomClassification'), checksum: { type: 'string', pattern: '^[0-9a-f]{64}$' }, byteSize: { type: 'integer', minimum: 1, maximum: 50000000 }, contentType: { type: 'string' }, supersedesId: { type: ['string', 'null'], format: 'uuid' } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('DataRoomDocument')) } }) },
  '/orgs/{id}/offerings/{oid}/documents/upload-intents': { post: operation({ id: 'createDataRoomUploadIntent', summary: 'PART-13. Creates a short-lived, one-file upload capability. The document is unavailable until quarantine scanning succeeds.', tag: 'investment', permission: 'offering.manage', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('oid', 'Offering identifier.')], body: { type: 'object', required: ['title', 'category', 'classification', 'fileName', 'contentType', 'size'], additionalProperties: false, properties: { title: { type: 'string' }, category: ref('DataRoomCategory'), classification: ref('DataRoomClassification'), fileName: { type: 'string' }, contentType: { enum: ['application/pdf', 'image/png', 'image/jpeg'] }, size: { type: 'integer', minimum: 5 }, supersedesId: { type: ['string', 'null'], format: 'uuid' } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', additionalProperties: true }) } }) },
  '/orgs/{id}/offerings/{oid}/documents/{documentId}/content': { put: operation({ id: 'uploadDataRoomContent', summary: 'PART-13. Receives exactly the declared byte count into quarantine using the short-lived upload token.', tag: 'investment', permission: 'offering.manage plus upload token', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('oid', 'Offering identifier.'), uuidParam('documentId', 'Document identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { received: { type: 'integer' } } }) } }) },
  '/orgs/{id}/offerings/{oid}/documents/{documentId}/finalize': { post: operation({ id: 'finalizeDataRoomUpload', summary: 'PART-13. Validates type and active content, computes SHA-256, and promotes only clean bytes.', tag: 'investment', permission: 'offering.manage plus upload token', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('oid', 'Offering identifier.'), uuidParam('documentId', 'Document identifier.')], success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', additionalProperties: true }) } }) },
  '/orgs/{id}/offerings/{oid}/grants': {
    get: operation({ id: 'listDataRoomGrants', summary: 'BUS-03. Who is in the room and who has asked to be. Expired and revoked are reported as different facts.', tag: 'investment', permission: 'dataroom.manage', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('oid', 'Offering identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { grants: { type: 'array', items: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, userId: { type: 'string', format: 'uuid' }, name: { type: 'string' }, expiresAt: { type: 'string', format: 'date-time' }, revokedAt: { type: ['string', 'null'], format: 'date-time' }, revokeReason: { type: 'string' }, live: { type: 'boolean' } } } }, requests: { type: 'array', items: { type: 'object', additionalProperties: true } } } }) } }),
    post: operation({ id: 'grantDataRoomAccess', summary: 'BUS-03.A02. A time-boxed grant into this offering’s room and no other.', tag: 'investment', permission: 'dataroom.manage', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('oid', 'Offering identifier.')], body: { type: 'object', required: ['userId', 'expiresAt'], additionalProperties: false, properties: { userId: { type: 'string', format: 'uuid' }, expiresAt: { type: 'string', format: 'date-time', description: 'Must be in the future. A grant without an end is standing access to a private room.' } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { id: { type: 'string', format: 'uuid' }, userId: { type: 'string', format: 'uuid' }, expiresAt: { type: 'string', format: 'date-time' } } }) } })
  },
  '/dataroom-grants/{id}/revoke': { post: operation({ id: 'revokeDataRoomAccess', summary: 'BUS-03.A03. Closes the room to someone, recording why. The grant that existed stays on the record.', tag: 'investment', permission: 'dataroom.manage', params: [uuidParam('id', 'Grant identifier.')], body: { type: 'object', required: ['reason'], additionalProperties: false, properties: { reason: { type: 'string', minLength: 10, maxLength: 1000 } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { id: { type: 'string', format: 'uuid' }, revokedAt: { type: 'string', format: 'date-time' }, revokeReason: { type: 'string' } } }) } }) },

  '/admin/investment-reviews': { get: operation({ id: 'listInvestmentReviews', summary: 'ADM-04. Offerings and eligibility applications awaiting an independent reviewer.', tag: 'admin', permission: 'RiskReviewer grant with MFA', success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { offerings: { type: 'array', items: ref('Offering') }, eligibility: { type: 'array', items: { type: 'object', additionalProperties: true } }, allocations: { type: 'array', items: { type: 'object', additionalProperties: true, properties: { id: { type: 'string', format: 'uuid' }, offeringId: { type: 'string', format: 'uuid' }, checksum: { type: 'string' }, totalUnits: ref('ShareCount'), totalMinor: ref('MinorUnits'), decidableByYou: { type: 'boolean', description: 'False where this reviewer proposed the schedule or belongs to the issuing organisation. Said in the queue rather than discovered on submit.' } } } } } }) } }) },
  '/admin/investment-reviews/{id}': { get: operation({ id: 'getInvestmentReview', summary: 'ADM-04. One offering with its disclosure, its terms check and its decision history.', tag: 'admin', permission: 'RiskReviewer grant with MFA', params: [uuidParam('id', 'Offering identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', additionalProperties: true }) } }) },
  '/admin/offerings/{id}/claim': { post: operation({ id: 'claimOfferingReview', summary: 'Claims a submission atomically, so two reviewers cannot work on the same one.', tag: 'admin', permission: 'RiskReviewer grant with MFA', params: [uuidParam('id', 'Offering identifier.')], success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('Offering')) } }) },
  '/admin/offerings/{id}/decision': { post: operation({ id: 'decideOffering', summary: 'ADM-04.A01. Append-only, bound to the disclosure that was judged, and refused for anyone who is a member of the issuing organisation. Approving does not publish.', tag: 'admin', permission: 'RiskReviewer grant with MFA', params: [uuidParam('id', 'Offering identifier.')], body: { type: 'object', required: ['outcome', 'publicReason', 'version'], additionalProperties: false, properties: { outcome: ref('ReviewOutcome'), publicReason: { type: 'string', maxLength: 1000, description: 'At least 10 characters unless the outcome is approved.' }, version: { type: 'integer', minimum: 1 } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('Offering')) } }) },
  '/admin/eligibility/{id}': { get: operation({ id: 'getEligibilityReview', summary: 'ADM-04.A02. One application, with the answers exactly as submitted.', tag: 'admin', permission: 'RiskReviewer grant with MFA', params: [uuidParam('id', 'Eligibility identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', additionalProperties: true }) } }) },
  '/admin/eligibility/{id}/decision': { post: operation({ id: 'decideEligibility', summary: 'ADM-04.A02. Append-only. An approval must carry an expiry, which a CHECK constraint enforces, and nobody reviews their own application.', tag: 'admin', permission: 'RiskReviewer grant with MFA', params: [uuidParam('id', 'Eligibility identifier.')], body: { type: 'object', required: ['outcome', 'reason', 'version'], additionalProperties: false, properties: { outcome: ref('ReviewOutcome'), reason: { type: 'string', maxLength: 1000 }, validityDays: { type: 'integer', minimum: 1, maximum: 1095, description: 'How long an approval lasts. Defaults to 365 days.' }, version: { type: 'integer', minimum: 1 } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { id: { type: 'string', format: 'uuid' }, state: ref('EligibilityState'), expiresAt: { type: ['string', 'null'], format: 'date-time' }, reason: { type: 'string' }, version: { type: 'integer' } } }) } }) },

  // ---- PART-09: commitment, subscription, allocation and the investor's own record --------------
  // Money on this path runs through the same payment intent, the same signed webhook and the same
  // inbox as a charity contribution. There is one idempotency boundary in this product; a second
  // one for investments would be a second chance to get it wrong.
  '/offerings/{id}/capacity': { get: operation({ id: 'readOfferingCapacity', summary: 'What is left in an offering, and whether the minimum would be met if it closed now.', tag: 'investment', permission: 'public', public: true, params: [uuidParam('id', 'Offering identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('OfferingCapacity')) } }) },
  '/offerings/{id}/commitments': { post: operation({ id: 'createCommitment', summary: 'PER-08.A01. Reserves capacity for a limited time. Locks the offering before reading what is left, so two investors cannot both be sold the last share. Creates no contract and no holding.', tag: 'investment', permission: 'self, with a current eligibility decision where the offering requires one', params: [uuidParam('id', 'Offering identifier.')], body: { type: 'object', required: ['amountMinor'], additionalProperties: false, properties: { amountMinor: { ...ref('MinorUnits'), description: 'What the investor wants to put in. The reply states what it actually buys and what is left over.' } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('Commitment')) } }) },
  '/commitments/{id}/confirm': { post: operation({ id: 'confirmCommitment', summary: 'PER-08.A02. Signs the contract against a named disclosure version. INV-03: a revised disclosure or a lapsed eligibility stops this, and the reservation survives rather than being destroyed.', tag: 'investment', permission: 'self (own commitment)', params: [uuidParam('id', 'Commitment identifier.')], body: { type: 'object', required: ['disclosureChecksum', 'acknowledgedRisk', 'version'], additionalProperties: false, properties: { disclosureChecksum: { type: 'string', pattern: '^[0-9a-f]{64}$', description: 'The exact text being agreed to. A mismatch is a conflict, never a silent upgrade to the current version.' }, acknowledgedRisk: { type: 'boolean', description: 'Must be true. Acknowledging the possibility of total loss is not optional at the binding step.' }, version: { type: 'integer', minimum: 1 } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { commitment: ref('Commitment'), subscription: ref('Subscription') } }) } }) },
  '/commitments/{id}/payment-intents': { post: operation({ id: 'payCommitment', summary: 'PER-08.A03. Opens a payment intent against the confirmed contract, into the offering’s own escrow. Disclosure and eligibility are re-checked here too, because time passed since confirming.', tag: 'investment', permission: 'self (own commitment)', params: [uuidParam('id', 'Commitment identifier.')], success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { commitmentId: { type: 'string', format: 'uuid' }, paymentIntentId: { type: 'string', format: 'uuid' }, status: ref('PaymentIntentState'), providerRedirectPath: { type: 'string', description: 'The simulator’s page. No real provider exists in this build.' }, amountMinor: ref('MinorUnits'), currency: { type: 'string' }, expiresAt: { type: 'string', format: 'date-time' }, simulated: { type: 'boolean' } } }) } }) },
  '/commitments/{id}/cancel': { post: operation({ id: 'cancelCommitment', summary: 'PER-08.A04. Gives up a reservation before paying. The capacity is freed and the record of what happened is kept.', tag: 'investment', permission: 'self (own commitment)', params: [uuidParam('id', 'Commitment identifier.')], body: { type: 'object', required: ['reason', 'version'], additionalProperties: false, properties: { reason: { type: 'string', minLength: 10, maxLength: 1000 }, version: { type: 'integer', minimum: 1 } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('Commitment')) } }) },

  '/me/investments': { get: operation({ id: 'readPortfolio', summary: 'PER-06. Proven holdings and in-flight commitments, in separate lists. No valuation is shown, and the reply says so rather than leaving an absent field to be read as zero.', tag: 'investment', permission: 'self', success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('Portfolio')) } }) },
  '/me/commitments': { get: operation({ id: 'listMyCommitments', summary: 'PER-08. Every commitment this investor has made, with whether its reservation has lapsed and whether the offering has moved on from the disclosure it was made against.', tag: 'investment', permission: 'self', success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'array', items: { type: 'object', additionalProperties: true } }) } }) },
  '/me/commitments/{id}': { get: operation({ id: 'readMyCommitment', summary: 'PER-09. One investment in full: the contract, the payment, the allocation and the holding if there is one. Absent for anyone else.', tag: 'investment', permission: 'self (own commitment)', params: [uuidParam('id', 'Commitment identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', additionalProperties: true }) } }) },
  '/ventures/{id}/investor-relations': { get: operation({ id: 'readInvestorRelations', summary: 'PER-09. Company reports, this investor’s own distribution lines and recorded events. Absent to anyone holding nothing in this company.', tag: 'investment', permission: 'self (must hold in this venture)', params: [uuidParam('id', 'Venture identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('InvestorRelations')) } }) },

  '/orgs/{id}/offerings/{oid}/allocations': { get: operation({ id: 'readAllocationBook', summary: 'BUS-04. Who committed what and where each one has got to. The issuer needs to know who subscribed in order to issue to them; this is that read, and it is not public.', tag: 'investment', permission: 'finance.read', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('oid', 'Offering identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', additionalProperties: true }) } }) },
  '/orgs/{id}/offerings/{oid}/allocations/preview': { post: operation({ id: 'previewAllocation', summary: 'BUS-04.A01. Computes the schedule from settled money only, changing nothing. Reports money that arrived but has not settled rather than quietly leaving it out.', tag: 'investment', permission: 'offering.manage', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('oid', 'Offering identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('AllocationSchedule')) } }) },
  '/orgs/{id}/offerings/{oid}/allocations/requests': { post: operation({ id: 'requestAllocation', summary: 'BUS-04.A02. Submits the computed schedule for an independent decision. The issuer cannot issue shares to itself.', tag: 'investment', permission: 'offering.manage', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('oid', 'Offering identifier.')], success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { id: { type: 'string', format: 'uuid' }, state: { type: 'string' }, checksum: { type: 'string', pattern: '^[0-9a-f]{64}$' }, totalUnits: ref('ShareCount'), totalMinor: ref('MinorUnits'), version: { type: 'integer' } } }) } }) },
  '/orgs/{id}/offerings/{oid}/closing': { get: operation({ id: 'readClosingReadiness', summary: 'INV-04. What still stands between a failed offering and being closed, named rather than merely refused.', tag: 'investment', permission: 'finance.read', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('oid', 'Offering identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('ClosingReadiness')) } }) },
  '/orgs/{id}/offerings/{oid}/fail': { post: operation({ id: 'declareOfferingFailed', summary: 'BUS-04.A03. Declares the minimum missed. It does not close the offering: it marks what must be returned. Refused if the minimum was in fact reached.', tag: 'investment', permission: 'offering.manage', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('oid', 'Offering identifier.')], body: versionBody('Offering version.'), success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { id: { type: 'string', format: 'uuid' }, state: ref('OfferingState'), toRefund: { type: 'integer' }, raisedMinor: ref('MinorUnits'), minimumRaiseMinor: ref('MinorUnits'), version: { type: 'integer' } } }) } }) },
  '/orgs/{id}/offerings/{oid}/close-after-refunds': { post: operation({ id: 'closeFailedOffering', summary: 'BUS-04.A04. Closes a failed offering, and only once every commitment is resolved and the escrow holds nothing. A conflict here means something is still owed.', tag: 'investment', permission: 'offering.manage', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('oid', 'Offering identifier.')], body: versionBody('Offering version.'), success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { id: { type: 'string', format: 'uuid' }, state: ref('OfferingState'), version: { type: 'integer' } } }) } }) },

  '/orgs/{id}/investor-relations': { get: operation({ id: 'readIssuerInvestorRelations', summary: 'BUS-05. The issuer’s own view: holders, allocated units, published reports, distributions and events.', tag: 'investment', permission: 'organization.read', params: [uuidParam('id', 'Organisation identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', additionalProperties: true }) } }) },
  '/orgs/{id}/company-reports': { post: operation({ id: 'publishCompanyReport', summary: 'BUS-05.A01. A numbered report to investors. Notification is queued separately, so a failed delivery cannot undo a published report.', tag: 'investment', permission: 'report.publish', params: [uuidParam('id', 'Organisation identifier.')], body: { type: 'object', required: ['title', 'body', 'periodStart', 'periodEnd'], additionalProperties: false, properties: { title: { type: 'string', minLength: 4, maxLength: 200 }, body: { type: 'string', minLength: 50, maxLength: 20000 }, periodStart: { type: 'string', format: 'date' }, periodEnd: { type: 'string', format: 'date' } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { id: { type: 'string', format: 'uuid' }, sequence: { type: 'integer' }, title: { type: 'string' }, publishedAt: { type: 'string', format: 'date-time' } } }) } }) },
  '/orgs/{id}/distributions': { post: operation({ id: 'proposeDistribution', summary: 'BUS-05.A02. Computes every holder’s line from the register as it stands, in integers. Refused where nobody holds anything, rather than dividing by zero.', tag: 'investment', permission: 'payout.request', params: [uuidParam('id', 'Organisation identifier.')], body: { type: 'object', required: ['totalMinor', 'reason'], additionalProperties: false, properties: { totalMinor: ref('MinorUnits'), reason: { type: 'string', minLength: 10, maxLength: 1000 } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('Distribution')) } }) },
  '/distributions/{id}/approve': { post: operation({ id: 'approveDistribution', summary: 'BUS-05.A03. An approval by someone who did not propose it, refused if the register has moved since the lines were computed.', tag: 'investment', permission: 'payout.approve, separated from the proposer; or a FinanceOperator grant', params: [uuidParam('id', 'Distribution identifier.')], body: versionBody('Distribution version.'), success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { id: { type: 'string', format: 'uuid' }, state: { type: 'string' }, version: { type: 'integer' } } }) } }) },
  '/orgs/{id}/corporate-events': { post: operation({ id: 'recordCorporateEvent', summary: 'BUS-05.A04. Records an exit, buyback, loss or liquidation from an approved document. It changes no holding by itself, and the reply says so.', tag: 'investment', permission: 'offering.manage', params: [uuidParam('id', 'Organisation identifier.')], body: { type: 'object', required: ['kind', 'title', 'body', 'effectiveAt'], additionalProperties: false, properties: { kind: { type: 'string', enum: ['report', 'distribution', 'buyback', 'exit', 'loss', 'liquidation'] }, title: { type: 'string', minLength: 4, maxLength: 200 }, body: { type: 'string', minLength: 20, maxLength: 10000 }, documentRef: { type: 'string', maxLength: 200 }, effectiveAt: { type: 'string', format: 'date-time' } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { id: { type: 'string', format: 'uuid' }, kind: { type: 'string' }, title: { type: 'string' }, effectiveAt: { type: 'string', format: 'date-time' }, holdingsChanged: { type: 'boolean', description: 'Always false. 06: an event is a record and a trigger for a process, never an adjustment to the register.' }, note: { type: 'string' } } }) } }) },

  '/admin/allocation-requests/{id}/finalize': { post: operation({ id: 'finaliseAllocation', summary: 'ADM-04.A03. The only operation in the product that creates a holding. Bound to the reviewed checksum, refused to the requester and to any member of the issuing organisation, and every commitment is re-checked at the moment of issue.', tag: 'admin', permission: 'RiskReviewer grant with MFA, separated from the requester', params: [uuidParam('id', 'Allocation request identifier.')], body: { type: 'object', required: ['checksum', 'version'], additionalProperties: false, properties: { checksum: { type: 'string', pattern: '^[0-9a-f]{64}$' }, version: { type: 'integer', minimum: 1 } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { id: { type: 'string', format: 'uuid' }, state: { type: 'string' }, allocated: { type: 'integer' }, totalUnits: ref('ShareCount'), simulated: { type: 'boolean', description: 'Always true. No database row created legal ownership, and a screen must not present this as a share register.' }, version: { type: 'integer' } } }) } }) },
  '/admin/allocation-requests/{id}/reject': { post: operation({ id: 'rejectAllocation', summary: 'ADM-04.A03. Sends a schedule back with a reason, issuing nothing.', tag: 'admin', permission: 'RiskReviewer grant with MFA, separated from the requester', params: [uuidParam('id', 'Allocation request identifier.')], body: { type: 'object', required: ['reason', 'version'], additionalProperties: false, properties: { reason: { type: 'string', minLength: 10, maxLength: 1000 }, version: { type: 'integer', minimum: 1 } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { id: { type: 'string', format: 'uuid' }, state: { type: 'string' }, reason: { type: 'string' }, version: { type: 'integer' } } }) } }) },
  '/admin/commitments/{id}/refund': { post: operation({ id: 'refundCommitment', summary: 'INV-04. Returns one investor’s money on a failed offering and posts the movement to the escrow. Refused if the escrow does not actually hold it: a promised refund out of cash that is not there is a shortfall, and 08 requires that recognised rather than approved.', tag: 'admin', permission: 'FinanceOperator grant with MFA', params: [uuidParam('id', 'Commitment identifier.')], success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { id: { type: 'string', format: 'uuid' }, state: ref('CommitmentState'), amountMinor: { ...ref('MinorUnits'), description: 'The full amount subscribed. The processor fee was funded by the platform, not taken out of what the contract names.' } } }) } }) },
  '/admin/distributions/{id}/paid': { post: operation({ id: 'markDistributionPaid', summary: 'Marks an approved distribution paid. No money moves: there is no payout rail to a person in this build, only to an organisation’s verified bank account, and the reply says so in `note`.', tag: 'admin', permission: 'FinanceOperator grant with MFA', params: [uuidParam('id', 'Distribution identifier.')], body: versionBody('Distribution version.'), success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { id: { type: 'string', format: 'uuid' }, state: { type: 'string' }, simulated: { type: 'boolean' }, note: { type: 'string', enum: ['no_investor_payout_rail'] }, version: { type: 'integer' } } }) } }) },

  // ---- PART-10: programmes, applications, seats and training ------------------------------------
  // The prefixes follow who decides. `/programs/...` is public, `/me/...` is the candidate's own
  // record, `/orgs/...` is the operator, `/cohorts/...` and `/sessions/...` are what an assigned
  // trainer reaches, and `/admin/...` is the independent reviewer. Nothing here creates a job.
  '/programs': { get: operation({ id: 'browsePrograms', summary: 'PUB-09. Programmes open to the public. Anything before `recruiting` is absent, not forbidden.', tag: 'programs', permission: 'public', public: true, query: [{ name: 'skill', description: 'Filter by one taught skill.' }, { name: 'city', description: 'Filter by city.' }, { name: 'cursor', description: 'Opaque cursor from the previous page.' }, { name: 'limit', description: 'Page size, 1-100, default 20.' }], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'array', items: ref('PublicProgram') }) } }) },
  '/programs/{slug}': { get: operation({ id: 'readPublicProgram', summary: 'PUB-10. One programme, with every disclosure 07 requires a candidate to be able to read before applying.', tag: 'programs', permission: 'public', public: true, params: [tokenParam('slug', 'Programme slug.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('PublicProgram')) } }) },
  '/programs/{slug}/curriculum': { get: operation({ id: 'readProgramCurriculum', summary: 'PUB-10.A03. The public curriculum: what is taught, for how long, and how it is assessed.', tag: 'programs', permission: 'public', public: true, params: [tokenParam('slug', 'Programme slug.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', additionalProperties: true }) } }) },

  '/me/candidate-profile': {
    get: operation({ id: 'readCandidateProfile', summary: 'PER-10. The candidate’s own skills profile, absent rather than blank when never filled in.', tag: 'programs', permission: 'self', success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('CandidateProfile')) } }),
    patch: operation({ id: 'saveCandidateProfile', summary: 'PER-10.A01. Save it. Consent is part of the same save, defaults to off, and contact sharing cannot outlive profile sharing.', tag: 'programs', permission: 'profile.manage', body: { type: 'object', additionalProperties: false, properties: { headline: { type: 'string', maxLength: 200 }, summary: { type: 'string', maxLength: 2000 }, city: { type: 'string', maxLength: 100 }, availability: { type: 'string', maxLength: 200 }, education: { type: 'string', maxLength: 1000 }, experience: { type: 'string', maxLength: 2000 }, skills: { type: 'array', maxItems: 40, items: { type: 'string', maxLength: 60 } }, cvReference: { type: 'string', maxLength: 200 }, shareWithOperators: { type: 'boolean' }, shareContact: { type: 'boolean' }, version: { type: 'integer', minimum: 0 } } }, success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('CandidateProfile')) } })
  },
  '/me/candidate-profile/employer-preview': { get: operation({ id: 'readEmployerPreview', summary: 'PER-10.A03. Exactly what an operator receives, produced by the same allowlist they read, plus a named list of what is withheld.', tag: 'programs', permission: 'self', success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { shared: { type: 'boolean' }, withheld: { type: 'array', items: { type: 'string' } }, profile: ref('SharedCandidateProfile') } }) } }) },

  '/applications': { post: operation({ id: 'saveApplicationDraft', summary: 'PER-11.A01. A draft. It reserves nothing and is visible to nobody else. One application per person per cohort, enforced by a unique index.', tag: 'programs', permission: 'self', body: { type: 'object', required: ['cohortId'], additionalProperties: false, properties: { cohortId: { type: 'string', format: 'uuid' }, answers: { type: 'object', additionalProperties: true }, motivation: { type: 'string', maxLength: 4000 }, sharingConsent: { type: 'boolean' }, applicationId: { type: 'string', format: 'uuid', description: 'Present when editing an existing draft.' }, version: { type: 'integer', minimum: 1 } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('Application')) } }) },
  '/applications/{id}/submit': { post: operation({ id: 'submitApplication', summary: 'PER-11.A02. Submitting. The deadline is checked here, at submission, not when the form was opened.', tag: 'programs', permission: 'self (own application)', params: [uuidParam('id', 'Application identifier.')], body: { type: 'object', required: ['sharingConsent', 'version'], additionalProperties: false, properties: { sharingConsent: { type: 'boolean', description: 'Must be true. Sharing the profile with this operator is what makes the candidacy assessable at all.' }, version: { type: 'integer', minimum: 1 } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('Application')) } }) },
  '/applications/{id}/discard': { post: operation({ id: 'discardApplication', summary: 'PER-11.A04. Archives a draft. It was never anybody else’s, so nothing is notified.', tag: 'programs', permission: 'self (own application)', params: [uuidParam('id', 'Application identifier.')], body: versionBody('Application version.'), success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('Application')) } }) },
  '/applications/{id}/withdraw': { post: operation({ id: 'withdrawApplication', summary: 'PER-12.A02. Withdrawing. Frees the seat where one was held, and keeps the record of why.', tag: 'programs', permission: 'self (own application)', params: [uuidParam('id', 'Application identifier.')], body: { type: 'object', required: ['reason', 'version'], additionalProperties: false, properties: { reason: { type: 'string', minLength: 10, maxLength: 1000 }, version: { type: 'integer', minimum: 1 } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('Application')) } }) },
  '/me/applications': { get: operation({ id: 'listMyApplications', summary: 'PER-12. Every application this person made, with where each one has got to.', tag: 'programs', permission: 'self', success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'array', items: { type: 'object', additionalProperties: true } }) } }) },
  '/me/applications/{id}': { get: operation({ id: 'readMyApplication', summary: 'PER-12.A01. One application in full, with the reasons the candidate was given. The reviewer’s private note is not in it.', tag: 'programs', permission: 'self (own application)', params: [uuidParam('id', 'Application identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', additionalProperties: true }) } }) },

  '/interviews/{id}/confirm': { post: operation({ id: 'confirmInterview', summary: 'PER-12.A03. The candidate confirms their own appointment; nobody confirms it for them.', tag: 'programs', permission: 'self (own application)', params: [uuidParam('id', 'Interview identifier.')], body: versionBody('Interview version.'), success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('Interview')) } }) },
  '/interviews/{id}/reschedule-requests': { post: operation({ id: 'requestInterviewReschedule', summary: 'PER-12.A04. A request, not a change: the appointment stands until the operator acts, so two people never hold two beliefs about when to turn up.', tag: 'programs', permission: 'self (own application)', params: [uuidParam('id', 'Interview identifier.')], body: { type: 'object', required: ['reason'], additionalProperties: false, properties: { reason: { type: 'string', minLength: 10, maxLength: 1000 }, alternatives: { type: 'string', maxLength: 1000 } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { id: { type: 'string', format: 'uuid' }, interviewId: { type: 'string', format: 'uuid' }, reason: { type: 'string' }, alternatives: { type: 'string' }, appointmentMoved: { type: 'boolean', const: false }, scheduledAt: { type: 'string', format: 'date-time' }, timezone: { type: 'string' } } }) } }) },
  '/enrollments/{id}/accept': { post: operation({ id: 'acceptSeat', summary: 'PER-12.A05. Accepting a seat. Locks the cohort and counts before writing, so two people cannot both take the last one, and an invitation that has lapsed cannot be accepted late.', tag: 'programs', permission: 'self (own enrolment)', params: [uuidParam('id', 'Enrolment identifier.')], body: versionBody('Enrolment version.'), success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('Enrollment')) } }) },

  '/me/training/{id}': { get: operation({ id: 'readMyTraining', summary: 'PER-13. This trainee’s own schedule, attendance and results, with the attendance rule quoted beside the counts.', tag: 'programs', permission: 'self (own enrolment)', params: [uuidParam('id', 'Enrolment identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('MyTraining')) } }) },
  '/attendance/{id}/objections': { post: operation({ id: 'objectToAttendance', summary: 'PER-13.A02. Disputing a record. It changes nothing by itself, and only one objection may be open at a time.', tag: 'programs', permission: 'self (own attendance record)', params: [uuidParam('id', 'Attendance identifier.')], body: { type: 'object', required: ['reason'], additionalProperties: false, properties: { reason: { type: 'string', minLength: 10, maxLength: 1000 } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { id: { type: 'string', format: 'uuid' }, attendanceId: { type: 'string', format: 'uuid' }, state: { type: 'string' }, recordChanged: { type: 'boolean', const: false } } }) } }) },
  '/enrollments/{id}/withdrawal-requests': { post: operation({ id: 'requestWithdrawal', summary: 'PER-13.A05. Asking to leave. Assessed against the programme’s published policy rather than applied, and the reply returns that policy.', tag: 'programs', permission: 'self (own enrolment)', params: [uuidParam('id', 'Enrolment identifier.')], body: { type: 'object', required: ['reason'], additionalProperties: false, properties: { reason: { type: 'string', minLength: 10, maxLength: 1000 } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { id: { type: 'string', format: 'uuid' }, state: { type: 'string' }, enrollmentChanged: { type: 'boolean', const: false }, policy: { type: 'string' } } }) } }) },

  '/orgs/{id}/programs': {
    get: operation({ id: 'listPrograms', summary: 'PRG-01. The operator’s own programmes, drafts included, with how many applications are waiting on a human decision.', tag: 'programs', permission: 'program.read', params: [uuidParam('id', 'Organisation identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'array', items: { type: 'object', additionalProperties: true } }) } }),
    post: operation({ id: 'createProgram', summary: 'PRG-02.A01. A draft programme. The operator must be verified, because a programme takes applications from the public.', tag: 'programs', permission: 'program.manage', params: [uuidParam('id', 'Organisation identifier.')], body: ref('ProgramInput'), success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('Program')) } })
  },
  '/orgs/{id}/programs/{pid}': {
    get: operation({ id: 'getProgram', summary: 'PRG-02. One programme with its cohorts, its readiness and its review history.', tag: 'programs', permission: 'program.read', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('pid', 'Programme identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', additionalProperties: true }) } }),
    patch: operation({ id: 'updateProgram', summary: 'PRG-02.A01. Editing, refused once a reviewer is looking at it.', tag: 'programs', permission: 'program.manage', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('pid', 'Programme identifier.')], body: { allOf: [ref('ProgramInput'), { type: 'object', required: ['version'], properties: { version: { type: 'integer', minimum: 1 } } }] }, success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('Program')) } })
  },
  '/orgs/{id}/programs/{pid}/validate': { post: operation({ id: 'validateProgram', summary: 'PRG-02. What a reviewer would refuse, without changing anything, so the operator can fix it before wasting a reviewer’s time.', tag: 'programs', permission: 'program.read', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('pid', 'Programme identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('ProgramReadiness')) } }) },
  '/orgs/{id}/programs/{pid}/submit': { post: operation({ id: 'submitProgram', summary: 'PRG-02.A03. Sends it to an independent reviewer and freezes it. An incomplete prospectus is refused here.', tag: 'programs', permission: 'program.manage', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('pid', 'Programme identifier.')], body: versionBody('Programme version.'), success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('Program')) } }) },
  '/orgs/{id}/programs/{pid}/publish': { post: operation({ id: 'publishProgram', summary: 'PRG-02.A04. Opens applications. Separate from approval: an approved programme is one the operator may open, not one already open.', tag: 'programs', permission: 'program.publish', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('pid', 'Programme identifier.')], body: versionBody('Programme version.'), success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('Program')) } }) },
  '/orgs/{id}/programs/{pid}/close-applications': { post: operation({ id: 'closeProgramApplications', summary: 'Stops new applications without ending the programme. Existing candidacies are untouched.', tag: 'programs', permission: 'program.manage', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('pid', 'Programme identifier.')], body: versionBody('Programme version.'), success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('Program')) } }) },
  '/orgs/{id}/programs/{pid}/cohorts': { post: operation({ id: 'addCohort', summary: 'PRG-02.A02. A group with its own seats and dates, which must start after applications close.', tag: 'programs', permission: 'program.manage', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('pid', 'Programme identifier.')], body: { type: 'object', required: ['name', 'capacity', 'startAt', 'endAt'], additionalProperties: false, properties: { name: { type: 'string', minLength: 2, maxLength: 140 }, capacity: { type: 'integer', minimum: 1, maximum: 100000 }, startAt: { type: 'string', format: 'date-time' }, endAt: { type: 'string', format: 'date-time' }, acceptanceWindowHours: { type: 'integer', minimum: 1, maximum: 720 }, timezone: { type: 'string', maxLength: 60 } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('Cohort')) } }) },

  '/orgs/{id}/applications': { get: operation({ id: 'listApplications', summary: 'PRG-03. The screening queue. A candidate’s profile appears only where they consented, and revoking the consent removes it from this read at once.', tag: 'programs', permission: 'application.review', params: [uuidParam('id', 'Organisation identifier.')], query: [{ name: 'program', description: 'Programme identifier.' }, { name: 'cohort', description: 'Cohort identifier.' }, { name: 'state', description: 'One application state.' }, { name: 'pending', description: 'true limits it to what is waiting on a human decision.' }], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'array', items: { type: 'object', additionalProperties: true } }) } }) },
  '/orgs/{id}/applications/{aid}': { get: operation({ id: 'getApplication', summary: 'PRG-03.A01. One candidate, with only what they agreed to share, plus the operator’s own private review notes.', tag: 'programs', permission: 'application.review', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('aid', 'Application identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', additionalProperties: true }) } }) },
  '/orgs/{id}/applications/{aid}/reviews': { post: operation({ id: 'reviewApplication', summary: 'PRG-03.A02. A score against a rubric. Append-only, and the note never reaches the candidate.', tag: 'programs', permission: 'application.review', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('aid', 'Application identifier.')], body: { type: 'object', required: ['scores', 'note'], additionalProperties: false, properties: { scores: { type: 'object', additionalProperties: { type: 'integer', minimum: 0, maximum: 100 } }, note: { type: 'string', minLength: 10, maxLength: 2000 }, scaleMax: { type: 'integer', minimum: 1, maximum: 100 } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { id: { type: 'string', format: 'uuid' }, total: { type: 'integer' }, scaleMax: { type: 'integer' } } }) } }) },
  '/orgs/{id}/applications/{aid}/interviews': { post: operation({ id: 'scheduleInterview', summary: 'PRG-03.A03. An appointment with the zone it was set in. A time in the past, or an in-person appointment with nowhere to be, is refused.', tag: 'programs', permission: 'application.review', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('aid', 'Application identifier.')], body: { type: 'object', required: ['scheduledAt'], additionalProperties: false, properties: { scheduledAt: { type: 'string', format: 'date-time' }, durationMinutes: { type: 'integer', minimum: 5, maximum: 480 }, timezone: { type: 'string', maxLength: 60 }, mode: ref('DeliveryMode'), location: { type: 'string', maxLength: 300 } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('Interview')) } }) },
  '/orgs/{id}/applications/{aid}/decision': { post: operation({ id: 'decideApplication', summary: 'PRG-03.A04. Accept, waitlist or reject. Accepting locks the cohort and counts the seats actually held, so two simultaneous acceptances cannot both take the last one; a full cohort is refused rather than silently waitlisted.', tag: 'programs', permission: 'application.review', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('aid', 'Application identifier.')], body: { type: 'object', required: ['outcome', 'reason', 'version'], additionalProperties: false, properties: { outcome: { type: 'string', enum: ['accepted', 'waitlisted', 'rejected'] }, reason: { type: 'string', maxLength: 1000, description: 'At least 10 characters unless the outcome is accepted. It is what the candidate is shown, so it is written for them.' }, version: { type: 'integer', minimum: 1 } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { application: ref('Application'), enrollment: { anyOf: [ref('Enrollment'), { type: 'null' }] }, waitlistPosition: { type: ['integer', 'null'] }, trainingIsNotEmployment: { type: 'boolean', const: true } } }) } }) },
  '/orgs/{id}/cohorts/{cid}/capacity': { get: operation({ id: 'readCohortCapacity', summary: 'Seats held, seats left and the length of the queue, so a screen never invites an operator to accept into a full cohort.', tag: 'programs', permission: 'program.read', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('cid', 'Cohort identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('CohortCapacity')) } }) },
  '/orgs/{id}/attendance-objections': { get: operation({ id: 'listAttendanceObjections', summary: 'PRG-05.A04. Disputes waiting on a decision, each saying whether this reader may be the one to decide it.', tag: 'programs', permission: 'attendance.review', params: [uuidParam('id', 'Organisation identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'array', items: { type: 'object', additionalProperties: true, properties: { decidableByYou: { type: 'boolean', description: 'False where this reader made the record or raised the objection.' } } } }) } }) },

  '/cohorts/{id}': { get: operation({ id: 'readCohortBoard', summary: 'PRG-04. Members, seats, trainers, sessions and the waitlist in its documented order. A trainer reaches only the cohorts they were assigned.', tag: 'programs', permission: 'program.read, plus an active cohort assignment for a trainer', params: [uuidParam('id', 'Cohort identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', additionalProperties: true }) } }) },
  '/cohorts/{id}/trainers': { post: operation({ id: 'assignTrainer', summary: 'PRG-04.A01. Assigning a trainer, which is the only thing that grants them their scope. The person must be an active member of the operator.', tag: 'programs', permission: 'program.manage', params: [uuidParam('id', 'Cohort identifier.')], body: { type: 'object', required: ['userId'], additionalProperties: false, properties: { userId: { type: 'string', format: 'uuid' } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { id: { type: 'string', format: 'uuid' }, userId: { type: 'string', format: 'uuid' }, cohortId: { type: 'string', format: 'uuid' } } }) } }) },
  '/cohorts/{id}/trainers/{tid}/revoke': { post: operation({ id: 'revokeTrainer', summary: 'Removing the assignment removes the scope, immediately and everywhere.', tag: 'programs', permission: 'program.manage', params: [uuidParam('id', 'Cohort identifier.'), uuidParam('tid', 'Assignment identifier.')], success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { id: { type: 'string', format: 'uuid' }, revoked: { type: 'boolean' } } }) } }) },
  '/cohorts/{id}/sessions': { post: operation({ id: 'createTrainingSession', summary: 'PRG-04.A02. A session inside the cohort’s own dates, carrying the cohort’s timezone.', tag: 'programs', permission: 'program.manage', params: [uuidParam('id', 'Cohort identifier.')], body: { type: 'object', required: ['title', 'startsAt', 'endsAt'], additionalProperties: false, properties: { title: { type: 'string', minLength: 3, maxLength: 200 }, startsAt: { type: 'string', format: 'date-time' }, endsAt: { type: 'string', format: 'date-time' }, mode: ref('DeliveryMode'), location: { type: 'string', maxLength: 300 } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('TrainingSession')) } }) },
  '/cohorts/{id}/waitlist/invite-next': { post: operation({ id: 'inviteNextFromWaitlist', summary: 'PRG-04.A03. Invites the next person in the queue’s stored order, under the cohort’s lock. With no free seat it is refused rather than silently doing nothing.', tag: 'programs', permission: 'application.review', params: [uuidParam('id', 'Cohort identifier.')], success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { enrollmentId: { type: 'string', format: 'uuid' }, applicationId: { type: 'string', format: 'uuid' }, invitedFromPosition: { type: 'integer' }, invitationExpiresAt: { type: 'string', format: 'date-time' } } }) } }) },
  '/cohorts/{id}/assessments': { post: operation({ id: 'createAssessment', summary: 'A rubric for the cohort. The pass mark is a total across every criterion, so its ceiling is the scale times the number of criteria.', tag: 'programs', permission: 'assessment.record', params: [uuidParam('id', 'Cohort identifier.')], body: { type: 'object', required: ['title', 'rubric'], additionalProperties: false, properties: { title: { type: 'string', minLength: 3, maxLength: 200 }, rubric: { type: 'object', additionalProperties: { type: 'integer', minimum: 1, maximum: 100 } }, scaleMax: { type: 'integer', minimum: 1, maximum: 100 }, passMark: { type: 'integer', minimum: 0, maximum: 100 } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { id: { type: 'string', format: 'uuid' }, title: { type: 'string' }, scaleMax: { type: 'integer' }, passMark: { type: 'integer' } } }) } }) },
  '/assessments/{id}/results': { post: operation({ id: 'recordAssessmentResult', summary: 'PRG-05.A03. A result scored only against the criteria the rubric names, for a trainee in the recorder’s own cohort.', tag: 'programs', permission: 'assessment.record', params: [uuidParam('id', 'Assessment identifier.')], body: { type: 'object', required: ['enrollmentId', 'scores'], additionalProperties: false, properties: { enrollmentId: { type: 'string', format: 'uuid' }, scores: { type: 'object', additionalProperties: { type: 'integer', minimum: 0, maximum: 100 } }, note: { type: 'string', maxLength: 2000 } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { id: { type: 'string', format: 'uuid' }, total: { type: 'integer' }, scaleMax: { type: 'integer' }, passMark: { type: 'integer' }, passed: { type: 'boolean' } } }) } }) },
  '/enrollments/{id}/withdraw': { post: operation({ id: 'recordEnrollmentWithdrawal', summary: 'PRG-04.A04. Records an exit. The attendance and assessment records stay: an exit is not an erasure.', tag: 'programs', permission: 'program.manage', params: [uuidParam('id', 'Enrolment identifier.')], body: { type: 'object', required: ['reason', 'version'], additionalProperties: false, properties: { reason: { type: 'string', minLength: 10, maxLength: 1000 }, version: { type: 'integer', minimum: 1 }, terminated: { type: 'boolean', description: 'True where the operator ended it rather than the trainee leaving.' } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { id: { type: 'string', format: 'uuid' }, state: ref('EnrollmentState'), exitReason: { type: 'string' }, recordsRetained: { type: 'boolean', const: true } } }) } }) },

  '/sessions/{id}/attendance': {
    get: operation({ id: 'readAttendanceRegister', summary: 'PRG-05. The register, with every confirmed member on it whether recorded or not.', tag: 'programs', permission: 'attendance.record, scoped to the trainer’s own cohorts', params: [uuidParam('id', 'Session identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('AttendanceRegister')) } }),
    put: operation({ id: 'saveAttendance', summary: 'PRG-05.A01/A02. One record per trainee per session. A change is a revision that says what it changed and why; after the register is closed the reason is mandatory, because by then the record may already have been counted.', tag: 'programs', permission: 'attendance.record; a change after close needs attendance.correct', params: [uuidParam('id', 'Session identifier.')], body: { type: 'object', required: ['entries'], additionalProperties: false, properties: { entries: { type: 'array', minItems: 1, maxItems: 500, items: { type: 'object', required: ['enrollmentId', 'status'], additionalProperties: false, properties: { enrollmentId: { type: 'string', format: 'uuid' }, status: ref('AttendanceStatus'), excuseNote: { type: 'string', maxLength: 1000, description: 'Required for `excused`: an excused absence without a reason is an absence somebody decided to be kind about.' }, reason: { type: 'string', maxLength: 1000 }, version: { type: 'integer', minimum: 1 } } } } } }, success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { sessionId: { type: 'string', format: 'uuid' }, written: { type: 'integer' }, revised: { type: 'integer' }, afterClose: { type: 'boolean' } } }) } })
  },
  '/sessions/{id}/close': { post: operation({ id: 'closeTrainingSession', summary: 'Closes the register. After this a change is a revision and says so on its face.', tag: 'programs', permission: 'attendance.record', params: [uuidParam('id', 'Session identifier.')], body: versionBody('Session version.'), success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('TrainingSession')) } }) },
  '/attendance-objections/{id}/decision': { post: operation({ id: 'decideAttendanceObjection', summary: 'PRG-05.A04. Ruling on a dispute. Upholding it corrects the record through a revision. Neither the person who made the record nor the person disputing it may decide — refused in the service and again by a CHECK constraint.', tag: 'programs', permission: 'attendance.review, separated from the recorder and the objector', params: [uuidParam('id', 'Objection identifier.')], body: { type: 'object', required: ['outcome', 'reason', 'version'], additionalProperties: false, properties: { outcome: { type: 'string', enum: ['upheld', 'rejected'] }, reason: { type: 'string', minLength: 10, maxLength: 1000 }, correctedStatus: ref('AttendanceStatus'), version: { type: 'integer', minimum: 1 } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { id: { type: 'string', format: 'uuid' }, state: { type: 'string' }, recordCorrected: { type: 'boolean' }, decisionReason: { type: 'string' } } }) } }) },

  '/admin/program-reviews': { get: operation({ id: 'listProgramReviews', summary: 'Programmes waiting for an independent content reviewer.', tag: 'admin', permission: 'ContentReviewer grant with MFA', success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'array', items: { type: 'object', additionalProperties: true } }) } }) },
  '/admin/program-reviews/{id}': { get: operation({ id: 'getProgramReview', summary: 'One programme with its cohorts, its readiness and its decision history.', tag: 'admin', permission: 'ContentReviewer grant with MFA', params: [uuidParam('id', 'Programme identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', additionalProperties: true }) } }) },
  '/admin/programs/{id}/claim': { post: operation({ id: 'claimProgramReview', summary: 'Claims a submission atomically, so two reviewers cannot work on the same one. Refused to anyone who is a member of the operator.', tag: 'admin', permission: 'ContentReviewer grant with MFA', params: [uuidParam('id', 'Programme identifier.')], success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('Program')) } }) },
  '/admin/programs/{id}/decision': { post: operation({ id: 'decideProgram', summary: 'Append-only, and refused to any member of the operator. Approving does not publish: the operator still decides when applications open.', tag: 'admin', permission: 'ContentReviewer grant with MFA', params: [uuidParam('id', 'Programme identifier.')], body: { type: 'object', required: ['outcome', 'publicReason', 'version'], additionalProperties: false, properties: { outcome: ref('ReviewOutcome'), publicReason: { type: 'string', maxLength: 1000, description: 'At least 10 characters unless the outcome is approved.' }, version: { type: 'integer', minimum: 1 } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('Program')) } }) },

  // ---- PART-11: jobs, referrals, offers, placements and follow-up --------------------------------
  // Two rules run through every operation below, and both are stated in the payloads rather than
  // left to be inferred: an accepted offer is not an employment (JOB-01), and a follow-up nobody
  // answered is `unknown`, not success (JOB-02).
  '/jobs': { get: operation({ id: 'browseJobs', summary: 'PUB-09/PUB-11. Published jobs. A draft is absent rather than forbidden, and pay is either stated or its absence is explained.', tag: 'employment', permission: 'public', public: true, query: [{ name: 'skill', description: 'Filter by one required skill.' }, { name: 'city', description: 'Filter by city.' }, { name: 'cursor', description: 'Opaque cursor from the previous page.' }, { name: 'limit', description: 'Page size, 1-100, default 20.' }], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'array', items: ref('PublicJob') }) } }) },
  '/jobs/{slug}': { get: operation({ id: 'readPublicJob', summary: 'PUB-11. One job. Carries no candidate data of any kind, and says whether it is still taking applications and why not when it is not.', tag: 'employment', permission: 'public', public: true, params: [tokenParam('slug', 'Job slug.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('PublicJob')) } }) },

  '/job-applications': { post: operation({ id: 'saveJobApplicationDraft', summary: 'PUB-11.A01. A draft job application, visible to nobody but its author. A job candidacy is its own record: being accepted onto training is not being accepted for work.', tag: 'employment', permission: 'self', body: { type: 'object', required: ['jobId'], additionalProperties: false, properties: { jobId: { type: 'string', format: 'uuid' }, coverNote: { type: 'string', maxLength: 4000 }, applicationId: { type: 'string', format: 'uuid', description: 'Present when editing an existing draft.' }, version: { type: 'integer', minimum: 1 } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('JobApplication')) } }) },
  '/job-applications/{id}/submit': { post: operation({ id: 'submitJobApplication', summary: 'Submitting. The deadline is checked here, at submission, and consent to share the profile with this employer is required rather than assumed.', tag: 'employment', permission: 'self (own application)', params: [uuidParam('id', 'Job application identifier.')], body: { type: 'object', required: ['sharingConsent', 'version'], additionalProperties: false, properties: { sharingConsent: { type: 'boolean', description: 'Must be true. Without it the employer sees nothing about the person and the candidacy cannot be assessed.' }, version: { type: 'integer', minimum: 1 } } }, success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('JobApplication')) } }) },
  '/job-applications/{id}/withdrawals': { post: operation({ id: 'withdrawJobApplication', summary: 'Withdrawing, with the reason kept on the record.', tag: 'employment', permission: 'self (own application)', params: [uuidParam('id', 'Job application identifier.')], body: { type: 'object', required: ['reason', 'version'], additionalProperties: false, properties: { reason: { type: 'string', minLength: 10, maxLength: 1000 }, version: { type: 'integer', minimum: 1 } } }, success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('JobApplication')) } }) },
  '/me/job-applications': { get: operation({ id: 'listMyJobApplications', summary: 'PER-14. This person’s job candidacies, their appointments and their latest offer.', tag: 'employment', permission: 'self', success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'array', items: { type: 'object', additionalProperties: true } }) } }) },

  '/me/job-referrals': { get: operation({ id: 'listMyJobReferrals', summary: 'Referrals waiting for this person’s agreement. Each one states that the employer has been told nothing about them yet.', tag: 'employment', permission: 'self', success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'array', items: { type: 'object', additionalProperties: true } }) } }) },
  '/job-referrals/{id}/response': { post: operation({ id: 'respondToJobReferral', summary: 'PRG-07.A05, the candidate’s half. Agreeing creates the application and shares the profile; declining shares nothing and ends it.', tag: 'employment', permission: 'self (own referral)', params: [uuidParam('id', 'Referral identifier.')], body: { type: 'object', required: ['accept', 'version'], additionalProperties: false, properties: { accept: { type: 'boolean' }, version: { type: 'integer', minimum: 1 } } }, success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { id: { type: 'string', format: 'uuid' }, accepted: { type: 'boolean' }, applicationId: { type: ['string', 'null'], format: 'uuid' }, profileShared: { type: 'boolean' } } }) } }) },

  '/job-offers/{id}': { get: operation({ id: 'readJobOffer', summary: 'PER-14. The offer as the candidate sees it, with the terms checksum they must quote back and the deadline resolved rather than implied. A draft is absent: it has not been sent.', tag: 'employment', permission: 'self (own offer)', params: [uuidParam('id', 'Offer identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('JobOffer')) } }) },
  '/job-offers/{id}/accept': { post: operation({ id: 'acceptJobOffer', summary: 'PER-14.A01 and JOB-01. Creates a placement in `start_pending`. It is not an employment, it is counted as one nowhere, and the reply says so in its own fields. Acceptance names the exact terms by checksum, so a changed offer cannot be accepted.', tag: 'employment', permission: 'self (own offer)', params: [uuidParam('id', 'Offer identifier.')], body: { type: 'object', required: ['termsChecksum', 'version'], additionalProperties: false, properties: { termsChecksum: { type: 'string', pattern: '^[0-9a-f]{64}$', description: 'The checksum of the terms the candidate actually read.' }, version: { type: 'integer', minimum: 1 } } }, success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { offer: ref('JobOffer'), placement: ref('Placement'), employmentStarted: { type: 'boolean', const: false, description: 'JOB-01. Saying yes is not turning up.' }, countedAsEmployment: { type: 'boolean', const: false }, awaitingStartConfirmation: { type: 'boolean', const: true } } }) } }) },
  '/job-offers/{id}/decline': { post: operation({ id: 'declineJobOffer', summary: 'PER-14.A02. A decision kept on the record with its reason.', tag: 'employment', permission: 'self (own offer)', params: [uuidParam('id', 'Offer identifier.')], body: { type: 'object', required: ['reason', 'version'], additionalProperties: false, properties: { reason: { type: 'string', minLength: 10, maxLength: 1000 }, version: { type: 'integer', minimum: 1 } } }, success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('JobOffer')) } }) },
  '/job-offers/{id}/send': { post: operation({ id: 'sendJobOffer', summary: 'PRG-08.A02. From here the text is frozen by a trigger and the clock is running. A change is a new version with its own sequence, so the candidate always knows which text they said yes to.', tag: 'employment', permission: 'job.manage', params: [uuidParam('id', 'Offer identifier.')], body: versionBody('Offer version.'), success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('JobOffer')) } }) },
  '/job-offers/{id}/withdraw': { post: operation({ id: 'withdrawJobOffer', summary: 'PRG-08.A03. Before acceptance only. Afterwards a placement exists, and unwinding it is an ended placement with its own record rather than a quietly retracted offer.', tag: 'employment', permission: 'job.manage', params: [uuidParam('id', 'Offer identifier.')], body: { type: 'object', required: ['reason', 'version'], additionalProperties: false, properties: { reason: { type: 'string', minLength: 10, maxLength: 1000 }, version: { type: 'integer', minimum: 1 } } }, success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('JobOffer')) } }) },

  '/me/placements': { get: operation({ id: 'listMyPlacements', summary: 'PER-14. This person’s placements, which checkpoints are due, and which side has confirmed the start.', tag: 'employment', permission: 'self', success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'array', items: { type: 'object', additionalProperties: true } }) } }) },
  '/placements/{id}/start-confirmations': { post: operation({ id: 'confirmPlacementStart', summary: 'PER-14.A03 and PRG-08.A04, one endpoint for both sides. A start becomes real when both parties name the same day, or when a reviewer decides against evidence. One side alone is a claim, and the reply says which side is still missing. Two different dates is recorded as a disagreement, not resolved by whoever wrote last.', tag: 'employment', permission: 'self (own placement), or placement.verify on the employing organisation', params: [uuidParam('id', 'Placement identifier.')], body: { type: 'object', required: ['startDate'], additionalProperties: false, properties: { startDate: { type: 'string', format: 'date', description: 'The day work actually began. A future date is refused.' }, evidenceRef: { type: 'string', maxLength: 200 }, asEmployer: { type: 'boolean', description: 'Record this as the employer’s confirmation. Still asserts placement.verify on the owning organisation.' } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { id: { type: 'string', format: 'uuid' }, state: ref('PlacementState'), started: { type: 'boolean' }, awaiting: { type: 'string', enum: ['employer', 'candidate', 'review', ''] }, reason: { type: 'string' }, actualStartDate: { type: ['string', 'null'], format: 'date' } } }) } }) },
  '/placements/{id}/followups': { post: operation({ id: 'recordPlacementFollowup', summary: 'PER-14.A04 and PRG-09.A02, and JOB-02. `unknown` is a permitted answer that writes no recorder and no source, so silence can never become success. Any other answer must name where it came from, enforced by a CHECK constraint as well as here. A checkpoint answered before it is due is refused.', tag: 'employment', permission: 'self (own placement), or placement.verify on the employing organisation', params: [uuidParam('id', 'Placement identifier.')], body: { type: 'object', required: ['dayOffset', 'result', 'version'], additionalProperties: false, properties: { dayOffset: { type: 'integer', enum: [30, 90], description: 'Days from the actual start date, never from the offer.' }, result: ref('FollowupResult'), source: { type: 'string', minLength: 3, maxLength: 120, description: 'Required for every result except `unknown`.' }, evidenceRef: { type: 'string', maxLength: 200 }, note: { type: 'string', maxLength: 1000 }, selfFound: { type: 'boolean', description: '14: work the person found themselves is reported separately, never added in.' }, version: { type: 'integer', minimum: 1 } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { id: { type: 'string', format: 'uuid' }, dayOffset: { type: 'integer' }, result: ref('FollowupResult'), answered: { type: 'boolean' }, placementState: ref('PlacementState'), countedAsRetained: { type: 'boolean' } } }) } }) },
  '/placements/{id}/followup-requests': { post: operation({ id: 'requestPlacementFollowup', summary: 'PRG-09.A01. Asks the question and writes no result. Separated from recording one entirely, because this is the action most likely to be quietly turned into an outcome.', tag: 'employment', permission: 'placement.verify', params: [uuidParam('id', 'Placement identifier.')], body: { type: 'object', required: ['dayOffset'], additionalProperties: false, properties: { dayOffset: { type: 'integer', enum: [30, 90] } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { placementId: { type: 'string', format: 'uuid' }, dayOffset: { type: 'integer' }, dueAt: { type: 'string', format: 'date' }, requested: { type: 'boolean', const: true }, result: ref('FollowupResult'), resultRecorded: { type: 'boolean', const: false, description: 'Always false. Asking is not answering.' } } }) } }) },
  '/placements/{id}/disputes': { post: operation({ id: 'disputePlacement', summary: 'PER-14.A05. The person objecting to what was recorded about them. The shared support queue is PART-13, so this is the placement’s own objection: it moves to `disputed`, which stops it counting either way until a reviewer settles it.', tag: 'employment', permission: 'self (own placement)', params: [uuidParam('id', 'Placement identifier.')], body: { type: 'object', required: ['reason', 'version'], additionalProperties: false, properties: { reason: { type: 'string', minLength: 10, maxLength: 1000 }, version: { type: 'integer', minimum: 1 } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('Placement')) } }) },
  '/placements/{id}/review-decisions': { post: operation({ id: 'reviewPlacement', summary: 'PRG-09.A03. Append-only, and `placement.review` is deliberately not a recruiter’s permission: the disagreement is decided by somebody other than the side that recorded the figure. Nobody may settle a start they themselves confirmed, and confirming one still requires an actual date and evidence — JOB-01 has no exception for an authority figure.', tag: 'employment', permission: 'placement.review', params: [uuidParam('id', 'Placement identifier.')], body: { type: 'object', required: ['outcome', 'reason', 'version'], additionalProperties: false, properties: { outcome: { type: 'string', enum: ['confirm_start', 'reject_start', 'confirm_end', 'reinstate'] }, reason: { type: 'string', minLength: 10, maxLength: 1000 }, startDate: { type: 'string', format: 'date', description: 'Required for `confirm_start`.' }, evidenceRef: { type: 'string', maxLength: 200, description: 'Required for `confirm_start`.' }, version: { type: 'integer', minimum: 1 } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('Placement')) } }) },

  '/orgs/{id}/jobs': {
    get: operation({ id: 'listJobs', summary: 'PRG-07. The employer’s own jobs, drafts included, with how many applications each has and whether the deadline has passed.', tag: 'employment', permission: 'organization.read', params: [uuidParam('id', 'Organisation identifier.')], query: [{ name: 'state', description: 'Filter by job state.' }], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'array', items: { type: 'object', additionalProperties: true } }) } }),
    post: operation({ id: 'createJob', summary: 'PRG-07.A01. A draft job, which is not public and accepts nothing. The organisation must be verified: no job without a known employer.', tag: 'employment', permission: 'job.manage', params: [uuidParam('id', 'Organisation identifier.')], body: ref('JobInput'), success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('Job')) } })
  },
  '/orgs/{id}/jobs/{jid}': {
    get: operation({ id: 'getJob', summary: 'One job as its employer sees it, with the publish blockers already worked out.', tag: 'employment', permission: 'organization.read', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('jid', 'Job identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', additionalProperties: true }) } }),
    patch: operation({ id: 'updateJob', summary: 'PRG-07.A02. Editing, refused while the job is open: changing what people applied to moves the goalposts under them.', tag: 'employment', permission: 'job.manage', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('jid', 'Job identifier.')], body: { allOf: [ref('JobInput'), { type: 'object', required: ['version'], properties: { version: { type: 'integer', minimum: 1 } } }] }, success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('Job')) } })
  },
  '/orgs/{id}/jobs/{jid}/validate': { post: operation({ id: 'validateJob', summary: 'What a publish would refuse, field by field and without changing anything, so the screen never offers a button that fails.', tag: 'employment', permission: 'job.manage', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('jid', 'Job identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('JobReadiness')) } }) },
  '/orgs/{id}/jobs/{jid}/publish': { post: operation({ id: 'publishJob', summary: 'PRG-07.A03. Opens the job. Verification and the deadline are re-checked here, because time passed since the draft was written.', tag: 'employment', permission: 'job.publish', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('jid', 'Job identifier.')], body: versionBody('Job version.'), success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('Job')) } }) },
  '/orgs/{id}/jobs/{jid}/close': { post: operation({ id: 'closeJob', summary: 'PRG-07.A04. Closing, with the candidacies still waiting dealt with rather than left hanging: it is refused while any are open unless the operator says to reject them, and each is shown the job’s own reason.', tag: 'employment', permission: 'job.manage', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('jid', 'Job identifier.')], body: { type: 'object', required: ['reason', 'version'], additionalProperties: false, properties: { reason: { type: 'string', minLength: 10, maxLength: 200 }, version: { type: 'integer', minimum: 1 }, rejectOpen: { type: 'boolean', description: 'Required when candidacies are still open. Rejects them with the closing reason.' } } }, success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ allOf: [ref('Job'), { type: 'object', properties: { applicationsRejected: { type: 'integer' } } }] }) } }) },
  '/orgs/{id}/jobs/{jid}/referrals': { post: operation({ id: 'referCandidate', summary: 'PRG-07.A05. Creates an invitation to be referred, not a referral: nothing about the person reaches the employer until they agree, and the reply states that plainly.', tag: 'employment', permission: 'application.review', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('jid', 'Job identifier.')], body: { type: 'object', required: ['userId'], additionalProperties: false, properties: { userId: { type: 'string', format: 'uuid' }, note: { type: 'string', maxLength: 1000 } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { id: { type: 'string', format: 'uuid' }, jobId: { type: 'string', format: 'uuid' }, profileShared: { type: 'boolean', const: false }, awaitingCandidateConsent: { type: 'boolean', const: true } } }) } }) },

  '/orgs/{id}/job-applications': { get: operation({ id: 'listJobApplications', summary: 'PRG-07/PRG-08. The employer’s queue. A candidate’s details appear only where they consented on this application and their profile is still set to share; otherwise the row names what is withheld and why.', tag: 'employment', permission: 'application.review', params: [uuidParam('id', 'Organisation identifier.')], query: [{ name: 'jobId', description: 'Filter to one job.' }, { name: 'pending', description: '`true` for candidacies still waiting on a human decision.' }], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'array', items: ref('EmployerJobApplication') }) } }) },
  '/orgs/{id}/job-applications/{aid}': { get: operation({ id: 'getJobApplication', summary: 'One candidacy in full, with its appointments and its offers.', tag: 'employment', permission: 'application.review', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('aid', 'Job application identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', additionalProperties: true }) } }) },
  '/orgs/{id}/job-applications/{aid}/decision': { post: operation({ id: 'decideJobApplication', summary: 'Moving a candidacy along. Rejecting says why, because the candidate is shown it. Every reply states a hired count of zero: nothing here is a job until a start is confirmed.', tag: 'employment', permission: 'application.review', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('aid', 'Job application identifier.')], body: { type: 'object', required: ['outcome', 'version'], additionalProperties: false, properties: { outcome: { type: 'string', enum: ['screening', 'shortlisted', 'rejected'] }, reason: { type: 'string', maxLength: 1000, description: 'Required, at least ten characters, when rejecting.' }, version: { type: 'integer', minimum: 1 } } }, success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ allOf: [ref('JobApplication'), { type: 'object', properties: { hiredCount: { type: 'integer', const: 0 } } }] }) } }) },
  '/orgs/{id}/job-applications/{aid}/interviews': { post: operation({ id: 'scheduleJobInterview', summary: 'An appointment for a job candidacy. The timezone is stored rather than assumed. It is confirmed and rescheduled through /interviews/{id}, which serves both kinds of candidacy.', tag: 'employment', permission: 'application.review', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('aid', 'Job application identifier.')], body: { type: 'object', required: ['scheduledAt', 'version'], additionalProperties: false, properties: { scheduledAt: { type: 'string', format: 'date-time' }, durationMinutes: { type: 'integer', minimum: 10, maximum: 480 }, timezone: { type: 'string', maxLength: 60 }, mode: { type: 'string', enum: ['in_person', 'remote', 'hybrid'] }, location: { type: 'string', maxLength: 300, description: 'Required unless the appointment is remote.' }, version: { type: 'integer', minimum: 1 } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('Interview')) } }) },

  '/orgs/{id}/job-offers': {
    get: operation({ id: 'listJobOffers', summary: 'PRG-08. Every offer this employer has made, with what became of it. An accepted offer is shown against its placement’s real state, never counted as a start.', tag: 'employment', permission: 'job.manage', params: [uuidParam('id', 'Organisation identifier.')], query: [{ name: 'jobId', description: 'Filter to one job.' }, { name: 'state', description: 'Filter by offer state.' }], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'array', items: { type: 'object', additionalProperties: true } }) } }),
    post: operation({ id: 'createJobOffer', summary: 'PRG-08.A01. A draft offer; nothing has been said to the candidate yet. Refused beyond the openings the job advertised, because an offer past them would promise work that does not exist.', tag: 'employment', permission: 'job.manage', params: [uuidParam('id', 'Organisation identifier.')], body: ref('JobOfferInput'), success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('JobOffer')) } })
  },
  '/orgs/{id}/job-offers/{oid}': { patch: operation({ id: 'updateJobOffer', summary: 'Editing a draft. A sent offer is refused here and by a trigger underneath.', tag: 'employment', permission: 'job.manage', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('oid', 'Offer identifier.')], body: { allOf: [ref('JobOfferInput'), { type: 'object', required: ['version'], properties: { version: { type: 'integer', minimum: 1 } } }] }, success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('JobOffer')) } }) },

  '/orgs/{id}/placements': { get: operation({ id: 'listPlacements', summary: 'PRG-09. Placements, which checkpoints are due and what each follow-up actually said. A candidate’s name appears only while their profile consent stands.', tag: 'employment', permission: 'placement.verify', params: [uuidParam('id', 'Organisation identifier.')], query: [{ name: 'state', description: 'Filter by placement state.' }, { name: 'due', description: '`true` for placements with a checkpoint that is due and unanswered.' }], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'array', items: { type: 'object', additionalProperties: true } }) } }) },
  '/orgs/{id}/placement-exports': { post: operation({ id: 'exportPlacements', summary: 'PRG-09.A04. Counts only, with the denominator named rather than implied, `unknown` reported as its own figure, and self-found work kept separate. No names and no contact details.', tag: 'employment', permission: 'report.read', params: [uuidParam('id', 'Organisation identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('PlacementSummary')) } }) },

  // ---- PART-12: agreements, stipends, certificates, incubation, assistance, volunteering ---------
  // Three things run through every operation below, stated in the payloads rather than left to be
  // inferred: a grant creates no equity, approving a deliverable releases no money, and an
  // assistance record reaches no sponsor, no export and no public page.
  '/orgs/{id}/agreements': {
    get: operation({ id: 'listAgreements', summary: 'BUS-06. Agreements this organisation is a party to, on either side. Each row says which side the reader is on and which party has still to accept the current version.', tag: 'enablement', permission: 'organization.read', params: [uuidParam('id', 'Organisation identifier.')], query: [{ name: 'role', description: '`sponsor` or `operator`, to see only one side.' }, { name: 'state', description: 'Filter by agreement state.' }], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'array', items: ref('Agreement') }) } }),
    post: operation({ id: 'createAgreement', summary: 'BUS-06.A01. A draft between two named organisations; the other side sees nothing yet. Cash needs an amount and a currency, in-kind needs a description and a stated estimated value, and 08 never adds the two together.', tag: 'enablement', permission: 'agreement.manage', params: [uuidParam('id', 'Organisation identifier.')], body: ref('AgreementInput'), success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('Agreement')) } })
  },
  '/orgs/{id}/agreements/{aid}': {
    get: operation({ id: 'getAgreement', summary: 'One agreement with its current terms, its milestones, its reports and what has been funded against it.', tag: 'enablement', permission: 'organization.read', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('aid', 'Agreement identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', additionalProperties: true }) } }),
    patch: operation({ id: 'updateAgreement', summary: 'Editing a draft. Once it has been sent, a change is a new revision the other side must accept afresh.', tag: 'enablement', permission: 'agreement.manage', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('aid', 'Agreement identifier.')], body: { allOf: [ref('AgreementInput'), { type: 'object', required: ['version'], properties: { version: { type: 'integer', minimum: 1 } } }] }, success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('Agreement')) } })
  },
  '/agreements/{id}/submit': { post: operation({ id: 'submitAgreement', summary: 'BUS-06.A02. Sends the terms to the other party as a numbered revision with a checksum. An acceptance of an earlier revision no longer matches, which is what stops a party being bound to a text they never read.', tag: 'enablement', permission: 'agreement.manage', params: [uuidParam('id', 'Agreement identifier.')], body: { type: 'object', required: ['terms', 'version'], additionalProperties: false, properties: { terms: { type: 'string', minLength: 50, maxLength: 8000 }, version: { type: 'integer', minimum: 1 } } }, success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('Agreement')) } }) },
  '/agreements/{id}/accept': { post: operation({ id: 'acceptAgreement', summary: 'BUS-06.A03. One party accepting one named version. It becomes active only when both have accepted the same checksum, and the reply says which side is still missing. Accepting on behalf of a party the actor cannot represent is refused.', tag: 'enablement', permission: 'agreement.accept, on the organisation whose side is being claimed', params: [uuidParam('id', 'Agreement identifier.')], body: { type: 'object', required: ['organizationId', 'checksum', 'version'], additionalProperties: false, properties: { organizationId: { type: 'string', format: 'uuid', description: 'The party being accepted for. The permission is checked against this organisation, not against whichever one the actor happens to belong to.' }, checksum: { type: 'string', pattern: '^[0-9a-f]{64}$' }, version: { type: 'integer', minimum: 1 } } }, success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ allOf: [ref('Agreement'), { type: 'object', properties: { acceptedBy: { type: 'array', items: { type: 'string' } }, awaiting: { type: 'string' }, active: { type: 'boolean' }, createsEquity: { type: 'boolean', const: false } } }] }) } }) },
  '/orgs/{id}/agreements/{aid}/milestones': { post: operation({ id: 'addAgreementMilestone', summary: 'A deliverable inside an agreement. The tranche it names is informational: approving it releases nothing.', tag: 'enablement', permission: 'agreement.manage', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('aid', 'Agreement identifier.')], body: { type: 'object', required: ['title', 'dueAt'], additionalProperties: false, properties: { title: { type: 'string', minLength: 4, maxLength: 200 }, description: { type: 'string', maxLength: 2000 }, dueAt: { type: 'string', format: 'date' }, amountMinor: { type: ['string', 'null'], pattern: '^[0-9]{1,16}$' } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('AgreementMilestone')) } }) },
  '/orgs/{id}/agreement-milestones/{mid}/evidence': { post: operation({ id: 'submitAgreementEvidence', summary: 'The operator saying a deliverable is done. A submission, not an approval, and it comes from the side doing the work.', tag: 'enablement', permission: 'agreement.manage, as the operator party', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('mid', 'Milestone identifier.')], body: { type: 'object', required: ['evidenceRef', 'version'], additionalProperties: false, properties: { evidenceRef: { type: 'string', minLength: 3, maxLength: 200 }, evidenceNote: { type: 'string', maxLength: 2000 }, version: { type: 'integer', minimum: 1 } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('AgreementMilestone')) } }) },
  '/orgs/{id}/agreement-milestones/{mid}/decision': { post: operation({ id: 'decideAgreementMilestone', summary: 'BUS-06.A04. Judged by the party that did not submit the evidence, and it releases no money — the decision row carries `releasedFunds: false` and a CHECK keeps it there. Releasing funds is the payout chain, with its own maker, its own approver and its own proof.', tag: 'enablement', permission: 'agreement.review, as the sponsor party', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('mid', 'Milestone identifier.')], body: { type: 'object', required: ['outcome', 'reason', 'version'], additionalProperties: false, properties: { outcome: { type: 'string', enum: ['approved', 'changes_requested'] }, reason: { type: 'string', minLength: 10, maxLength: 1000 }, evidenceRef: { type: 'string', maxLength: 200 }, version: { type: 'integer', minimum: 1 } } }, success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ allOf: [ref('AgreementMilestone'), { type: 'object', properties: { releasedFunds: { type: 'boolean', const: false }, note: { type: 'string', enum: ['approval_is_not_payment'] } } }] }) } }) },
  '/orgs/{id}/agreements/{aid}/reports': { post: operation({ id: 'createAgreementReport', summary: 'The operator’s report to the sponsor: money spent and outcomes reached. 12 forbids naming a trainee or an assistance applicant in it, so the figure describing people is a count.', tag: 'enablement', permission: 'report.create', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('aid', 'Agreement identifier.')], body: { type: 'object', required: ['periodStart', 'periodEnd'], additionalProperties: false, properties: { periodStart: { type: 'string', format: 'date' }, periodEnd: { type: 'string', format: 'date' }, narrative: { type: 'string', maxLength: 8000 }, spentMinor: ref('MinorUnits'), participantsReached: { type: 'integer', minimum: 0 }, outcomesNote: { type: 'string', maxLength: 4000 }, varianceNote: { type: 'string', maxLength: 2000, description: '14: a variance is stated rather than smoothed away.' } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('AgreementReport')) } }) },
  '/orgs/{id}/agreement-reports/{rid}/submit': { post: operation({ id: 'submitAgreementReport', summary: 'Sends a report to the sponsor. A report with nothing in it is refused: a funder cannot judge an empty narrative.', tag: 'enablement', permission: 'report.submit', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('rid', 'Report identifier.')], body: versionBody('Report version.'), success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('AgreementReport')) } }) },
  '/orgs/{id}/agreement-reports/{rid}/decision': { post: operation({ id: 'decideAgreementReport', summary: 'PRG-11.A02. The sponsor’s judgement on the operator’s report, never on its own. It moves no money either.', tag: 'enablement', permission: 'agreement.review, as the sponsor party', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('rid', 'Report identifier.')], body: { type: 'object', required: ['outcome', 'reason', 'version'], additionalProperties: false, properties: { outcome: { type: 'string', enum: ['approved', 'changes_requested'] }, reason: { type: 'string', minLength: 10, maxLength: 1000 }, version: { type: 'integer', minimum: 1 } } }, success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('AgreementReport')) } }) },
  '/agreements/{id}/funding-intents': { post: operation({ id: 'fundAgreement', summary: 'PRG-11.A01. A sponsor putting money behind an active agreement. It creates **no share**: `createsEquity` is false and a CHECK constraint keeps it there, because 07 keeps grant money and investment money on separate paths all the way down. No money moves in this build, and the reply says so.', tag: 'enablement', permission: 'sponsorship.fund', params: [uuidParam('id', 'Agreement identifier.')], body: { type: 'object', required: ['organizationId', 'amountMinor', 'currency'], additionalProperties: false, properties: { organizationId: { type: 'string', format: 'uuid' }, amountMinor: ref('MinorUnits'), currency: { type: 'string', pattern: '^[A-Za-z]{3}$' }, note: { type: 'string', maxLength: 1000 } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('FundingIntent')) } }) },
  '/orgs/{id}/sponsor-exports': { post: operation({ id: 'exportSponsorPortfolio', summary: 'PRG-11.A04. Counts and money only, with cash and in-kind kept as two figures. No names, no beneficiary records and no trainee files: 12 keeps them out of anything a funder reads.', tag: 'enablement', permission: 'report.read', params: [uuidParam('id', 'Organisation identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('SponsorExport')) } }) },

  '/orgs/{id}/cohorts/{cid}/stipend-preview': { get: operation({ id: 'previewStipend', summary: 'PRG-06. What a period would pay and every reason it could not, without writing anything. The blockers are named individually — an open session, an unresolved objection, a period already claimed — because "not ready" alone is not something an operator can act on.', tag: 'enablement', permission: 'stipend.request', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('cid', 'Cohort identifier.')], query: [{ name: 'from', description: 'Period start, YYYY-MM-DD.', required: true }, { name: 'to', description: 'Period end, YYYY-MM-DD.', required: true }], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('StipendPreview')) } }) },
  '/orgs/{id}/cohorts/{cid}/stipend-batches': {
    get: operation({ id: 'listStipendBatches', summary: 'Stipend periods for this cohort. Only a payout that actually paid means anybody received anything, and the row says which.', tag: 'enablement', permission: 'program.read', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('cid', 'Cohort identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'array', items: ref('StipendBatch') }) } }),
    post: operation({ id: 'createStipendBatch', summary: 'PRG-06.A01. Writes the entitlement lines and nothing else — no payout, no money, no change to the enrolment. 07: a stipend tied to attendance is not assembled before the register is closed and its objections are settled. **A period is never paid twice**: an exclusion constraint refuses an overlapping period for the same enrolment outright.', tag: 'enablement', permission: 'stipend.request', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('cid', 'Cohort identifier.')], body: { type: 'object', required: ['periodStart', 'periodEnd'], additionalProperties: false, properties: { periodStart: { type: 'string', format: 'date' }, periodEnd: { type: 'string', format: 'date' } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('StipendBatch')) } })
  },
  '/orgs/{id}/stipend-batches/{bid}/payout-request': { post: operation({ id: 'requestStipendPayout', summary: 'PRG-06.A02. Hands the total to finance and stops. The entitlement is re-checked at this moment, not only when the batch was assembled, because a session can be reopened and an objection raised in between. The payout itself is PART-07’s chain, with its own independent approver — and no payment is ever raised from a certificate button.', tag: 'enablement', permission: 'payout.request', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('bid', 'Batch identifier.')], body: { type: 'object', required: ['projectId', 'reason', 'version'], additionalProperties: false, properties: { projectId: { type: 'string', format: 'uuid' }, reason: { type: 'string', minLength: 10, maxLength: 1000 }, invoiceReference: { type: 'string', maxLength: 120 }, version: { type: 'integer', minimum: 1 } } }, success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ allOf: [ref('StipendBatch'), { type: 'object', properties: { payoutRaised: { type: 'boolean', const: false }, moneyMoved: { type: 'boolean', const: false }, nextStep: { type: 'string' } } }] }) } }) },
  '/orgs/{id}/stipend-batches/{bid}/cancel': { post: operation({ id: 'cancelStipendBatch', summary: 'Cancels a batch and frees the days its lines claimed. A paid batch is history and cannot be cancelled: reversing one is a refund, not a cancellation.', tag: 'enablement', permission: 'stipend.request', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('bid', 'Batch identifier.')], body: { type: 'object', required: ['reason', 'version'], additionalProperties: false, properties: { reason: { type: 'string', minLength: 10, maxLength: 1000 }, version: { type: 'integer', minimum: 1 } } }, success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ allOf: [ref('StipendBatch'), { type: 'object', properties: { periodReleased: { type: 'boolean', const: true } } }] }) } }) },
  '/orgs/{id}/enrollments/{eid}/certificate-readiness': { get: operation({ id: 'certificateReadiness', summary: 'Whether a trainee has finished, with the attendance figure and the programme’s own published rule quoted beside it, so a disagreement is visible rather than hidden.', tag: 'enablement', permission: 'program.read', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('eid', 'Enrolment identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('CertificateReadiness')) } }) },
  '/orgs/{id}/enrollments/{eid}/certificate': { post: operation({ id: 'issueCertificate', summary: 'PRG-06.A03. Issuing. It pays nothing and promises nothing about work, and the reply says both. The public reference carries no national identifier.', tag: 'enablement', permission: 'certificate.issue', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('eid', 'Enrolment identifier.')], success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('Certificate')) } }) },
  '/orgs/{id}/certificates/{cid}/revoke': { post: operation({ id: 'revokeCertificate', summary: 'PRG-06.A04. The reason and its evidence are private; the public reference keeps resolving and answers that it is no longer valid. A reference that simply stopped working would leave whoever holds a copy unable to find out why.', tag: 'enablement', permission: 'certificate.revoke', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('cid', 'Certificate identifier.')], body: { type: 'object', required: ['reason', 'version'], additionalProperties: false, properties: { reason: { type: 'string', minLength: 10, maxLength: 1000 }, evidenceRef: { type: 'string', maxLength: 200 }, version: { type: 'integer', minimum: 1 } } }, success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ allOf: [ref('Certificate'), { type: 'object', properties: { publicReferenceStillResolves: { type: 'boolean', const: true }, reasonIsPrivate: { type: 'boolean', const: true } } }] }) } }) },
  '/certificates/{publicId}/verify': { get: operation({ id: 'verifyCertificate', summary: 'The public check. Anyone holding the reference can ask whether it is valid. It carries a holder name and a programme — a certificate nobody can attribute verifies nothing — and no national identifier, no contact detail, no attendance figure, no assessment score and no revocation reason.', tag: 'enablement', permission: 'public', public: true, params: [tokenParam('publicId', 'The reference printed on the certificate.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('CertificateCheck')) } }) },
  '/me/certificates': { get: operation({ id: 'listMyCertificates', summary: 'PER-13. The holder’s own certificates. They are told why one was revoked; the public check is not.', tag: 'enablement', permission: 'self', success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'array', items: ref('Certificate') }) } }) },
  '/me/stipends': { get: operation({ id: 'listMyStipends', summary: 'PER-13. The trainee’s own stipend lines, with the arithmetic shown rather than a bare figure, so it can be checked rather than taken on trust. Only a paid payout means money arrived.', tag: 'enablement', permission: 'self', success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'array', items: { type: 'object', additionalProperties: true } }) } }) },

  '/me/proposals': { get: operation({ id: 'listMyProposals', summary: 'PER-16. The founder’s own ideas, with every decision, mentor, agreement and milestone attached.', tag: 'enablement', permission: 'self', success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'array', items: { type: 'object', additionalProperties: true } }) } }) },
  '/proposals': { post: operation({ id: 'saveProposal', summary: 'PER-16.A01. A private draft, attached to no incubator. Nobody else can see it, and submitting an idea costs the founder no share of it.', tag: 'enablement', permission: 'self', body: { type: 'object', required: ['title'], additionalProperties: false, properties: { proposalId: { type: 'string', format: 'uuid', description: 'Present when editing an existing draft.' }, title: { type: 'string', minLength: 4, maxLength: 200 }, summary: { type: 'string', maxLength: 4000 }, problem: { type: 'string', maxLength: 4000 }, stage: { type: 'string', maxLength: 60 }, sector: { type: 'string', maxLength: 100 }, city: { type: 'string', maxLength: 100 }, supportSought: { type: 'string', maxLength: 2000 }, version: { type: 'integer', minimum: 1 } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('Proposal')) } }) },
  '/proposals/{id}/submit': { post: operation({ id: 'submitProposal', summary: 'PER-16.A02. Sending it to a verified incubator, with the consent to share it given in the same act. Until then the idea is the founder’s alone.', tag: 'enablement', permission: 'self (own proposal)', params: [uuidParam('id', 'Proposal identifier.')], body: { type: 'object', required: ['organizationId', 'sharingConsent', 'version'], additionalProperties: false, properties: { organizationId: { type: 'string', format: 'uuid' }, sharingConsent: { type: 'boolean', description: 'Must be true. An incubator cannot see an idea merely because it exists.' }, version: { type: 'integer', minimum: 1 } } }, success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ allOf: [ref('Proposal'), { type: 'object', properties: { equityTaken: { type: 'integer', const: 0 }, platformTakesNoStake: { type: 'boolean', const: true } } }] }) } }) },
  '/proposals/{id}/withdraw': { post: operation({ id: 'withdrawProposal', summary: 'Taking an idea back, with the reason kept on the record.', tag: 'enablement', permission: 'self (own proposal)', params: [uuidParam('id', 'Proposal identifier.')], body: { type: 'object', required: ['reason', 'version'], additionalProperties: false, properties: { reason: { type: 'string', minLength: 10, maxLength: 1000 }, version: { type: 'integer', minimum: 1 } } }, success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('Proposal')) } }) },
  '/incubation-agreements/{id}/accept': { post: operation({ id: 'acceptIncubationAgreement', summary: 'PER-16.A03. Accepting incubation terms by naming the checksum of the text read. It creates no company, issues no share and moves no money, and the reply states all three.', tag: 'enablement', permission: 'self (own proposal)', params: [uuidParam('id', 'Incubation agreement identifier.')], body: { type: 'object', required: ['checksum', 'version'], additionalProperties: false, properties: { checksum: { type: 'string', pattern: '^[0-9a-f]{64}$' }, version: { type: 'integer', minimum: 1 } } }, success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { agreement: ref('IncubationAgreement'), proposal: ref('Proposal'), grantsEquity: { type: 'boolean', const: false }, createsOrganization: { type: 'boolean', const: false }, moneyMoved: { type: 'boolean', const: false } } }) } }) },
  '/incubation-agreements/{id}/decline': { post: operation({ id: 'declineIncubationAgreement', summary: 'Refusing the terms, with a reason kept on the record.', tag: 'enablement', permission: 'self (own proposal)', params: [uuidParam('id', 'Incubation agreement identifier.')], body: { type: 'object', required: ['reason', 'version'], additionalProperties: false, properties: { reason: { type: 'string', minLength: 10, maxLength: 1000 }, version: { type: 'integer', minimum: 1 } } }, success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('IncubationAgreement')) } }) },
  '/incubation-milestones/{id}/evidence': { post: operation({ id: 'submitIncubationEvidence', summary: 'PER-16.A04. Evidence from the founder. Approving it is somebody else’s act, and it releases nothing.', tag: 'enablement', permission: 'self (own proposal)', params: [uuidParam('id', 'Milestone identifier.')], body: { type: 'object', required: ['evidenceRef', 'version'], additionalProperties: false, properties: { evidenceRef: { type: 'string', minLength: 3, maxLength: 200 }, evidenceNote: { type: 'string', maxLength: 4000 }, version: { type: 'integer', minimum: 1 } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('IncubationMilestone')) } }) },
  '/proposals/{id}/startup-link': { post: operation({ id: 'linkProposalStartup', summary: 'PER-16.A05, the server’s half. The founder creates the company themselves through the ordinary organisation form; this records which idea it came out of. It copies no identity, issues no share, and refuses a company the founder does not own.', tag: 'enablement', permission: 'self (own proposal) and Owner of the organisation', params: [uuidParam('id', 'Proposal identifier.')], body: { type: 'object', required: ['organizationId', 'version'], additionalProperties: false, properties: { organizationId: { type: 'string', format: 'uuid' }, version: { type: 'integer', minimum: 1 } } }, success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ allOf: [ref('Proposal'), { type: 'object', properties: { sharesIssued: { type: 'integer', const: 0 }, incubatorHoldsNoStake: { type: 'boolean', const: true }, note: { type: 'string', enum: ['company_created_by_the_founder'] } } }] }) } }) },
  '/orgs/{id}/proposals': { get: operation({ id: 'listProposals', summary: 'PRG-10. The incubator’s pipeline. A mentor sees only the ideas they were assigned, the same way a trainer sees only their cohorts.', tag: 'enablement', permission: 'program.read; scoped to assignments for a mentor', params: [uuidParam('id', 'Organisation identifier.')], query: [{ name: 'state', description: 'Filter by proposal state.' }], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'array', items: { type: 'object', additionalProperties: true } }) } }) },
  '/orgs/{id}/proposals/{pid}': { get: operation({ id: 'getProposal', summary: 'One idea in full. The reply says whether this reader may decide on it, so no screen has to infer that from a role name.', tag: 'enablement', permission: 'program.read; scoped to assignments for a mentor', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('pid', 'Proposal identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', additionalProperties: true }) } }) },
  '/orgs/{id}/proposals/{pid}/decision': { post: operation({ id: 'decideProposal', summary: 'PRG-10.A01. Accepting or refusing an idea, with the criteria it was judged against. A mentor cannot reach this: 08 says they comment and do not decide. Accepting an idea is accepting to work on it, not acquiring part of it.', tag: 'enablement', permission: 'proposal.review', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('pid', 'Proposal identifier.')], body: { type: 'object', required: ['outcome', 'reason', 'version'], additionalProperties: false, properties: { outcome: { type: 'string', enum: ['accepted', 'rejected'] }, reason: { type: 'string', minLength: 10, maxLength: 2000, description: 'Shown to the founder.' }, criteria: { type: 'string', maxLength: 2000 }, version: { type: 'integer', minimum: 1 } } }, success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ allOf: [ref('Proposal'), { type: 'object', properties: { equityTaken: { type: 'integer', const: 0 }, incubatorHoldsNoStake: { type: 'boolean', const: true } } }] }) } }) },
  '/orgs/{id}/proposals/{pid}/mentor-assignments': { post: operation({ id: 'assignMentor', summary: 'PRG-10.A02. The assignment is what gives a mentor any reach at all, and it grants reach rather than authority — the reply says so.', tag: 'enablement', permission: 'program.manage', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('pid', 'Proposal identifier.')], body: { type: 'object', required: ['mentorId'], additionalProperties: false, properties: { mentorId: { type: 'string', format: 'uuid' }, note: { type: 'string', maxLength: 1000 } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { id: { type: 'string', format: 'uuid' }, mentorId: { type: 'string', format: 'uuid' }, grantsDecisionRights: { type: 'boolean', const: false }, scope: { type: 'string', enum: ['this_proposal_only'] } } }) } }) },
  '/orgs/{id}/mentor-assignments/{aid}/end': { post: operation({ id: 'endMentorAssignment', summary: 'Ending an assignment. The reach goes with it immediately, the same rule PART-10 applies to a trainer.', tag: 'enablement', permission: 'program.manage', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('aid', 'Assignment identifier.')], body: { type: 'object', required: ['reason'], additionalProperties: false, properties: { reason: { type: 'string', minLength: 10, maxLength: 1000 } } }, success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { id: { type: 'string', format: 'uuid' }, endedAt: { type: 'string', format: 'date-time' }, accessRevoked: { type: 'boolean', const: true } } }) } }) },
  '/orgs/{id}/proposals/{pid}/incubation-agreements': { post: operation({ id: 'proposeIncubationAgreement', summary: 'PRG-10.A03. Rights, money and limits, each a required field. 07 names the IP terms specifically, because leaving them unsaid is how founders lose what they built. `grantsEquity` is false and a CHECK keeps it there.', tag: 'enablement', permission: 'agreement.manage', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('pid', 'Proposal identifier.')], body: ref('IncubationAgreementInput'), success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('IncubationAgreement')) } }) },
  '/orgs/{id}/incubation-agreements/{aid}/offer': { post: operation({ id: 'offerIncubationAgreement', summary: 'Sending the terms to the founder. From here the text is frozen by a trigger: a change is a new version with a new sequence, so a founder always knows which text they accepted.', tag: 'enablement', permission: 'agreement.manage', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('aid', 'Incubation agreement identifier.')], body: versionBody('Agreement version.'), success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('IncubationAgreement')) } }) },
  '/orgs/{id}/proposals/{pid}/milestones': { post: operation({ id: 'addIncubationMilestone', summary: 'A milestone on an accepted idea.', tag: 'enablement', permission: 'program.manage', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('pid', 'Proposal identifier.')], body: { type: 'object', required: ['title', 'dueAt'], additionalProperties: false, properties: { title: { type: 'string', minLength: 4, maxLength: 200 }, description: { type: 'string', maxLength: 2000 }, dueAt: { type: 'string', format: 'date' } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('IncubationMilestone')) } }) },
  '/orgs/{id}/incubation-milestones/{mid}/decision': { post: operation({ id: 'decideIncubationMilestone', summary: 'PRG-10.A04. Evidence first: approving a milestone nobody has evidenced approves nothing. It releases no money.', tag: 'enablement', permission: 'proposal.review', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('mid', 'Milestone identifier.')], body: { type: 'object', required: ['outcome', 'reason', 'version'], additionalProperties: false, properties: { outcome: { type: 'string', enum: ['approved', 'changes_requested'] }, reason: { type: 'string', minLength: 10, maxLength: 2000 }, evidenceRef: { type: 'string', maxLength: 200 }, version: { type: 'integer', minimum: 1 } } }, success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ allOf: [ref('IncubationMilestone'), { type: 'object', properties: { releasedFunds: { type: 'boolean', const: false } } }] }) } }) },
  '/orgs/{id}/proposals/{pid}/close': { post: operation({ id: 'closeProposal', summary: 'PRG-10.A05. An outcome, what it came to and what happens next. Milestones still open are counted in the reply rather than silently dropped: 22 forbids leaving an item without an owner.', tag: 'enablement', permission: 'program.manage', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('pid', 'Proposal identifier.')], body: { type: 'object', required: ['outcome', 'note', 'version'], additionalProperties: false, properties: { outcome: { type: 'string', enum: ['graduated', 'company_created', 'employment', 'ended'] }, note: { type: 'string', minLength: 20, maxLength: 2000 }, version: { type: 'integer', minimum: 1 } } }, success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ allOf: [ref('Proposal'), { type: 'object', properties: { milestonesLeftOpen: { type: 'integer' }, sharesIssued: { type: 'integer', const: 0 } } }] }) } }) },

  '/me/assistance': { get: operation({ id: 'listMyAssistance', summary: 'PER-15. The applicant’s own cases, in full, including every consent given and withdrawn. It is their record.', tag: 'enablement', permission: 'self', success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'array', items: { type: 'object', additionalProperties: true } }) } }) },
  '/assistance': { post: operation({ id: 'createAssistanceCase', summary: 'PER-15.A01. A request for help, with the least that has to be said to assess it. It goes to a verified organisation, because it hands over the most sensitive data a person has. Submitting records the consent in the same act, with its scope in the words the applicant was shown.', tag: 'enablement', permission: 'self', body: { type: 'object', required: ['organizationId', 'category', 'needSummary'], additionalProperties: false, properties: { organizationId: { type: 'string', format: 'uuid' }, category: { type: 'string', minLength: 2, maxLength: 60 }, needSummary: { type: 'string', minLength: 20, maxLength: 4000, description: 'HighlySensitive. Never in a public, sponsor or exported projection.' }, householdSize: { type: ['integer', 'null'], minimum: 1, maximum: 50 }, requestedMinor: { type: ['string', 'null'], pattern: '^[0-9]{1,16}$' }, currency: { type: ['string', 'null'], pattern: '^[A-Za-z]{3}$' }, submit: { type: 'boolean' } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('AssistanceCase')) } }) },
  '/assistance/{id}/submit': { post: operation({ id: 'submitAssistanceCase', summary: 'Sending a draft, with the consent given in the same act.', tag: 'enablement', permission: 'self (own case)', params: [uuidParam('id', 'Case identifier.')], body: { type: 'object', required: ['consent', 'version'], additionalProperties: false, properties: { consent: { type: 'boolean' }, version: { type: 'integer', minimum: 1 } } }, success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('AssistanceCase')) } }) },
  '/assistance/{id}/replies': { post: operation({ id: 'replyToAssistance', summary: 'PER-15.A02. A document or an answer, private to the case. Refused once the consent has been withdrawn.', tag: 'enablement', permission: 'self (own case)', params: [uuidParam('id', 'Case identifier.')], body: { type: 'object', required: ['body'], additionalProperties: false, properties: { body: { type: 'string', minLength: 2, maxLength: 4000 }, documentRef: { type: 'string', maxLength: 200 } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { id: { type: 'string', format: 'uuid' }, caseState: { type: 'string' } } }) } }) },
  '/assistance/{id}/deliveries/{did}/confirm': { post: operation({ id: 'confirmAssistanceDelivery', summary: 'PER-15.A03 and A04. An operator recording a delivery is a claim; the person receiving it is the one who confirms. Objecting moves the case to `disputed`, so it counts as nothing until somebody settles it — and a confirmation is not a payment: this build moves no money.', tag: 'enablement', permission: 'self (own case)', params: [uuidParam('id', 'Case identifier.'), uuidParam('did', 'Delivery identifier.')], body: { type: 'object', required: ['confirmed', 'version'], additionalProperties: false, properties: { confirmed: { type: 'boolean' }, reason: { type: 'string', maxLength: 1000, description: 'Required, at least ten characters, when disputing.' }, version: { type: 'integer', minimum: 1 } } }, success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('AssistanceDelivery')) } }) },
  '/assistance/{id}/consent-revocations': { post: operation({ id: 'revokeAssistanceConsent', summary: 'PER-15.A05. Withdrawing consent stops every operator action at once — each one re-checks the latest consent row — and does **not** delete the case: 12 keeps the record of what was already done, and the reply says exactly what was retained and why, so nobody is told their data vanished when it did not.', tag: 'enablement', permission: 'self (own case)', params: [uuidParam('id', 'Case identifier.')], body: { type: 'object', required: ['version'], additionalProperties: false, properties: { reason: { type: 'string', maxLength: 1000 }, version: { type: 'integer', minimum: 1 } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ allOf: [ref('AssistanceCase'), { type: 'object', properties: { processingStopped: { type: 'boolean', const: true }, operatorAccessEnded: { type: 'boolean', const: true }, recordRetained: { type: 'boolean', const: true }, retainedBecause: { type: 'string' }, reversible: { type: 'boolean', const: true } } }] }) } }) },
  '/orgs/{id}/assistance': { get: operation({ id: 'listAssistanceCases', summary: 'PRG-12. The organisation’s cases. A case whose consent was withdrawn keeps its reference and its state and loses its contents, including the applicant’s name.', tag: 'enablement', permission: 'assistance.manage', params: [uuidParam('id', 'Organisation identifier.')], query: [{ name: 'state', description: 'Filter by case state.' }, { name: 'mine', description: '`true` for cases assigned to this worker.' }], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'array', items: ref('AssistanceCase') }) } }) },
  '/orgs/{id}/assistance/{caseId}': { get: operation({ id: 'getAssistanceCase', summary: 'One case. Everything about the person is behind the consent: withdrawn, and the operator sees the shape of the case and none of its contents.', tag: 'enablement', permission: 'assistance.manage', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('caseId', 'Case identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', additionalProperties: true }) } }) },
  '/orgs/{id}/assistance/{caseId}/claim': { post: operation({ id: 'claimAssistanceCase', summary: 'Taking a case. 22: no pending item without an owner.', tag: 'enablement', permission: 'assistance.manage', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('caseId', 'Case identifier.')], body: versionBody('Case version.'), success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { id: { type: 'string', format: 'uuid' }, state: { type: 'string' }, caseWorkerId: { type: 'string', format: 'uuid' } } }) } }) },
  '/orgs/{id}/assistance/{caseId}/clarifications': { post: operation({ id: 'requestAssistanceClarification', summary: 'PRG-12.A01. A private message to the applicant, never a public note. Refused once consent is withdrawn, and only by the worker the case is assigned to.', tag: 'enablement', permission: 'assistance.manage, on the assigned case', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('caseId', 'Case identifier.')], body: { type: 'object', required: ['body', 'version'], additionalProperties: false, properties: { body: { type: 'string', minLength: 10, maxLength: 4000 }, version: { type: 'integer', minimum: 1 } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', properties: { id: { type: 'string', format: 'uuid' }, caseState: { type: 'string' }, private: { type: 'boolean', const: true } } }) } }) },
  '/orgs/{id}/assistance/{caseId}/decisions': { post: operation({ id: 'decideAssistanceCase', summary: 'PRG-12.A02. The eligibility decision. Append-only, never published, never in a sponsor report, and the internal criteria are not shown to the applicant.', tag: 'enablement', permission: 'assistance.manage, on the assigned case', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('caseId', 'Case identifier.')], body: { type: 'object', required: ['outcome', 'reason', 'version'], additionalProperties: false, properties: { outcome: { type: 'string', enum: ['approved', 'rejected'] }, reason: { type: 'string', minLength: 10, maxLength: 2000, description: 'Shown to the applicant.' }, criteria: { type: 'string', maxLength: 2000, description: 'Internal. Not shown to the applicant and not exported.' }, version: { type: 'integer', minimum: 1 } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ allOf: [ref('AssistanceCase'), { type: 'object', properties: { published: { type: 'boolean', const: false }, sharedWithSponsor: { type: 'boolean', const: false } } }] }) } }) },
  '/orgs/{id}/assistance/{caseId}/deliveries': { post: operation({ id: 'recordAssistanceDelivery', summary: 'PRG-12.A03. The funding source is required: 22 forbids an unexplained balance, and support that arrived from nowhere in particular is the same problem one step earlier. It waits for the applicant’s confirmation.', tag: 'enablement', permission: 'assistance.manage, on the assigned case', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('caseId', 'Case identifier.')], body: { type: 'object', required: ['description', 'fundingSource', 'deliveredAt', 'version'], additionalProperties: false, properties: { description: { type: 'string', minLength: 5, maxLength: 1000 }, fundingSource: { type: 'string', minLength: 3, maxLength: 200 }, amountMinor: { type: ['string', 'null'], pattern: '^[0-9]{1,16}$' }, currency: { type: ['string', 'null'], pattern: '^[A-Za-z]{3}$' }, evidenceRef: { type: 'string', maxLength: 200 }, deliveredAt: { type: 'string', format: 'date' }, version: { type: 'integer', minimum: 1 } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ allOf: [ref('AssistanceDelivery'), { type: 'object', properties: { awaitingApplicantConfirmation: { type: 'boolean', const: true }, moneyMovedThroughPlatform: { type: 'boolean', const: false } } }] }) } }) },
  '/orgs/{id}/assistance-deliveries/{did}/dispute-decision': { post: operation({ id: 'resolveAssistanceDispute', summary: 'Settling an objection to a delivery, by somebody other than the person who recorded it.', tag: 'enablement', permission: 'assistance.manage, separated from the recorder', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('did', 'Delivery identifier.')], body: { type: 'object', required: ['outcome', 'reason', 'version'], additionalProperties: false, properties: { outcome: { type: 'string', enum: ['upheld', 'dismissed'] }, reason: { type: 'string', minLength: 10, maxLength: 1000 }, version: { type: 'integer', minimum: 1 } } }, success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ allOf: [ref('AssistanceDelivery'), { type: 'object', properties: { caseState: { type: 'string' }, resolvedBySomeoneElse: { type: 'boolean', const: true } } }] }) } }) },
  '/orgs/{id}/assistance/{caseId}/close': { post: operation({ id: 'closeAssistanceCase', summary: 'PRG-12.A04. Refused while anything is unfinished: a delivery nobody confirmed, an open dispute, or an approved case that delivered nothing — which is an unpaid promise rather than a closed case.', tag: 'enablement', permission: 'assistance.manage, on the assigned case', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('caseId', 'Case identifier.')], body: { type: 'object', required: ['note', 'version'], additionalProperties: false, properties: { note: { type: 'string', minLength: 10, maxLength: 1000 }, version: { type: 'integer', minimum: 1 } } }, success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('AssistanceCase')) } }) },

  '/volunteer-opportunities': { get: operation({ id: 'browseVolunteerOpportunities', summary: 'PER-17. Published volunteering. A draft is absent rather than forbidden, and every card states that volunteering is unpaid and is not employment.', tag: 'enablement', permission: 'public', public: true, query: [{ name: 'city', description: 'Filter by city.' }], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'array', items: ref('PublicVolunteerOpportunity') }) } }) },
  '/volunteer-opportunities/{slug}': { get: operation({ id: 'readVolunteerOpportunity', summary: 'One opportunity, with the tasks, the requirements and the withdrawal policy a person decides from. 07 requires somebody answerable for a volunteer, so the page states that there is a named supervisor without naming them publicly.', tag: 'enablement', permission: 'public', public: true, params: [tokenParam('slug', 'Opportunity slug.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('PublicVolunteerOpportunity')) } }) },
  '/me/volunteering': { get: operation({ id: 'listMyVolunteering', summary: 'PER-17. This person’s applications, assignments and hours. Approved and awaiting are two figures, never one total.', tag: 'enablement', permission: 'self', success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', additionalProperties: true }) } }) },
  '/volunteer-applications': { post: operation({ id: 'applyToVolunteer', summary: 'PER-17.A01. One application per person per opportunity, enforced by a unique index.', tag: 'enablement', permission: 'self', body: { type: 'object', required: ['opportunityId'], additionalProperties: false, properties: { opportunityId: { type: 'string', format: 'uuid' }, motivation: { type: 'string', maxLength: 2000 }, availability: { type: 'string', maxLength: 500 } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('VolunteerApplication')) } }) },
  '/volunteer-applications/{id}/withdraw': { post: operation({ id: 'withdrawVolunteerApplication', summary: 'PER-17.A04. Withdrawing. The opportunity’s published policy comes back with the outcome, because that is what the withdrawal is judged against.', tag: 'enablement', permission: 'self (own application)', params: [uuidParam('id', 'Application identifier.')], body: { type: 'object', required: ['reason', 'version'], additionalProperties: false, properties: { reason: { type: 'string', minLength: 10, maxLength: 1000 }, version: { type: 'integer', minimum: 1 } } }, success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('VolunteerApplication')) } }) },
  '/volunteer-assignments/{id}/accept': { post: operation({ id: 'respondToVolunteerAssignment', summary: 'PER-17.A02. Nobody is placed without agreeing to the task.', tag: 'enablement', permission: 'self (own assignment)', params: [uuidParam('id', 'Assignment identifier.')], body: { type: 'object', required: ['accept', 'version'], additionalProperties: false, properties: { accept: { type: 'boolean' }, reason: { type: 'string', maxLength: 1000, description: 'Required, at least ten characters, when declining.' }, version: { type: 'integer', minimum: 1 } } }, success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('VolunteerAssignment')) } }) },
  '/volunteer-hours': { post: operation({ id: 'logVolunteerHours', summary: 'PER-17.A03. Hours are a claim until somebody else approves them, and the reply says they are not counted yet. Hours outside the assignment’s own dates are refused.', tag: 'enablement', permission: 'self (own assignment)', body: { type: 'object', required: ['assignmentId', 'workedOn', 'minutes'], additionalProperties: false, properties: { assignmentId: { type: 'string', format: 'uuid' }, workedOn: { type: 'string', format: 'date' }, minutes: { type: 'integer', minimum: 1, maximum: 1440 }, note: { type: 'string', maxLength: 1000 } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ allOf: [ref('VolunteerHours'), { type: 'object', properties: { awaitingApproval: { type: 'boolean', const: true }, countedYet: { type: 'boolean', const: false } } }] }) } }) },
  '/orgs/{id}/volunteering': { get: operation({ id: 'volunteerBoard', summary: 'PRG-13. The coordinator’s board: opportunities, the places left on each, applications waiting, assignments and hours. It opens no beneficiary file — 08 keeps volunteer management and assistance apart.', tag: 'enablement', permission: 'volunteer.manage', params: [uuidParam('id', 'Organisation identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'array', items: { type: 'object', additionalProperties: true } }) } }) },
  '/orgs/{id}/volunteer-opportunities': { post: operation({ id: 'createVolunteerOpportunity', summary: 'A draft opportunity, visible to nobody. The supervisor is a member of this organisation rather than a name typed into a field.', tag: 'enablement', permission: 'volunteer.manage', params: [uuidParam('id', 'Organisation identifier.')], body: ref('VolunteerOpportunityInput'), success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('VolunteerOpportunity')) } }) },
  '/orgs/{id}/volunteer-opportunities/{oid}': { patch: operation({ id: 'updateVolunteerOpportunity', summary: 'Editing. Refused while it is open: changing what people applied to, while they are applying, moves the goalposts under them.', tag: 'enablement', permission: 'volunteer.manage', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('oid', 'Opportunity identifier.')], body: { allOf: [ref('VolunteerOpportunityInput'), { type: 'object', required: ['version'], properties: { version: { type: 'integer', minimum: 1 } } }] }, success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('VolunteerOpportunity')) } }) },
  '/orgs/{id}/volunteer-opportunities/{oid}/validate': { post: operation({ id: 'validateVolunteerOpportunity', summary: 'What a publish would refuse, named field by field, so the screen never offers a button that fails.', tag: 'enablement', permission: 'volunteer.manage', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('oid', 'Opportunity identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('VolunteerReadiness')) } }) },
  '/orgs/{id}/volunteer-opportunities/{oid}/publish': { post: operation({ id: 'publishVolunteerOpportunity', summary: 'PRG-13.A01. Publishing. An unverified organisation cannot take people’s time any more than it can take their money, and the withdrawal policy has to be published before anybody applies.', tag: 'enablement', permission: 'volunteer.manage', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('oid', 'Opportunity identifier.')], body: versionBody('Opportunity version.'), success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('VolunteerOpportunity')) } }) },
  '/orgs/{id}/volunteer-opportunities/{oid}/close': { post: operation({ id: 'closeVolunteerOpportunity', summary: 'Closing. People still waiting on an answer are told, rather than left with a page that stops loading.', tag: 'enablement', permission: 'volunteer.manage', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('oid', 'Opportunity identifier.')], body: { type: 'object', required: ['reason', 'version'], additionalProperties: false, properties: { reason: { type: 'string', minLength: 10, maxLength: 200 }, version: { type: 'integer', minimum: 1 } } }, success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ allOf: [ref('VolunteerOpportunity'), { type: 'object', properties: { applicationsClosed: { type: 'integer' } } }] }) } }) },
  '/orgs/{id}/volunteer-applications/{aid}/decision': { post: operation({ id: 'decideVolunteerApplication', summary: 'PRG-13.A02. Decided against the places actually left. Accepting an application is not an assignment: the task is a separate, named thing the volunteer still has to accept.', tag: 'enablement', permission: 'volunteer.manage', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('aid', 'Application identifier.')], body: { type: 'object', required: ['outcome', 'version'], additionalProperties: false, properties: { outcome: { type: 'string', enum: ['accepted', 'rejected'] }, reason: { type: 'string', maxLength: 1000, description: 'Required, at least ten characters, when rejecting.' }, version: { type: 'integer', minimum: 1 } } }, success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ allOf: [ref('VolunteerApplication'), { type: 'object', properties: { assignmentCreated: { type: 'boolean', const: false }, nextStep: { type: 'string' } } }] }) } }) },
  '/orgs/{id}/volunteer-assignments': { post: operation({ id: 'assignVolunteer', summary: 'PRG-13.A03. A task for somebody the organisation accepted — an assignment to a stranger is a placement nobody agreed to — and they still have to accept it.', tag: 'enablement', permission: 'volunteer.manage', params: [uuidParam('id', 'Organisation identifier.')], body: { type: 'object', required: ['opportunityId', 'userId', 'task', 'startsAt'], additionalProperties: false, properties: { opportunityId: { type: 'string', format: 'uuid' }, userId: { type: 'string', format: 'uuid' }, task: { type: 'string', minLength: 5, maxLength: 1000 }, startsAt: { type: 'string', format: 'date' }, endsAt: { type: ['string', 'null'], format: 'date' } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ allOf: [ref('VolunteerAssignment'), { type: 'object', properties: { awaitingVolunteerAcceptance: { type: 'boolean', const: true } } }] }) } }) },
  '/orgs/{id}/volunteer-assignments/{aid}/end': { post: operation({ id: 'endVolunteerAssignment', summary: 'Ending an assignment, with a reason kept on the record.', tag: 'enablement', permission: 'volunteer.manage', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('aid', 'Assignment identifier.')], body: { type: 'object', required: ['reason', 'version'], additionalProperties: false, properties: { reason: { type: 'string', minLength: 10, maxLength: 1000 }, version: { type: 'integer', minimum: 1 } } }, success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope(ref('VolunteerAssignment')) } }) },
  '/orgs/{id}/volunteer-hours/{hid}/decision': { post: operation({ id: 'decideVolunteerHours', summary: 'PRG-13.A04. **Nobody approves their own hours** — refused here and by a database trigger, so a coordinator who also volunteers on the same opportunity cannot sign off their own time. It is the rule that decides whether a reported volunteer figure means anything.', tag: 'enablement', permission: 'volunteer.manage, and never the volunteer themselves', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('hid', 'Hours identifier.')], body: { type: 'object', required: ['outcome', 'version'], additionalProperties: false, properties: { outcome: { type: 'string', enum: ['approved', 'rejected'] }, reason: { type: 'string', maxLength: 1000, description: 'Required, at least ten characters, when rejecting.' }, version: { type: 'integer', minimum: 1 } } }, success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ allOf: [ref('VolunteerHours'), { type: 'object', properties: { approvedBySomeoneElse: { type: 'boolean', const: true } } }] }) } }) },

  // PART-13. Private support and notifications are deliberately separate from financial state.
  '/tickets': { post: operation({ id: 'createSupportTicket', summary: 'PER-20.A01. Creates a private support record. It does not reverse a ledger entry, publish a report or freeze a subject.', tag: 'operations', permission: 'self', body: { type: 'object', required: ['subjectType', 'category', 'title', 'body'], additionalProperties: false, properties: { organizationId: { type: 'string', format: 'uuid' }, subjectType: { type: 'string', minLength: 2, maxLength: 40 }, subjectId: { type: 'string', format: 'uuid' }, category: { type: 'string', minLength: 2, maxLength: 40 }, title: { type: 'string', minLength: 5, maxLength: 200 }, body: { type: 'string', minLength: 10, maxLength: 2000 } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', additionalProperties: true }) } }) },
  '/me/tickets': { get: operation({ id: 'listMySupportTickets', summary: 'The signed-in requester’s own tickets only.', tag: 'operations', permission: 'self', success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'array', items: { type: 'object', additionalProperties: true } }) } }) },
  '/tickets/{id}': { get: operation({ id: 'getSupportTicket', summary: 'A ticket for its requester or scoped platform staff. Internal replies are absent from the requester projection.', tag: 'operations', permission: 'ticket participant or scoped platform staff', params: [uuidParam('id', 'Ticket identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', additionalProperties: true }) } }) },
  '/tickets/{id}/replies': { post: operation({ id: 'replySupportTicket', summary: 'PER-20.A02 / ADM-07.A01. Adds append-only correspondence and moves next action to the other side.', tag: 'operations', permission: 'ticket participant or support.manage', params: [uuidParam('id', 'Ticket identifier.')], body: { type: 'object', required: ['body'], additionalProperties: false, properties: { body: { type: 'string', minLength: 2, maxLength: 4000 } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', additionalProperties: true }) } }) },
  '/tickets/{id}/reopen': { post: operation({ id: 'reopenSupportTicket', summary: 'PER-20.A03. Reopens with a new reason; history is retained.', tag: 'operations', permission: 'self (requester)', params: [uuidParam('id', 'Ticket identifier.')], body: { type: 'object', required: ['reason', 'version'], additionalProperties: false, properties: { reason: { type: 'string', minLength: 10, maxLength: 2000 }, version: { type: 'integer', minimum: 1 } } }, success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', additionalProperties: true }) } }) },
  '/tickets/{id}/confirm-resolution': { post: operation({ id: 'confirmSupportResolution', summary: 'PER-20.A04. The requester confirms a proposed resolution. Financial disputes remain separate.', tag: 'operations', permission: 'self (requester)', params: [uuidParam('id', 'Ticket identifier.')], body: versionBody('Ticket version.'), success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', additionalProperties: true }) } }) },
  '/me/notifications': { get: operation({ id: 'listMyNotifications', summary: 'PER-19. In-app notifications for this recipient. Links are internal safe paths and carry no health, bank or document text.', tag: 'operations', permission: 'self', success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'array', items: { type: 'object', additionalProperties: true } }) } }) },
  '/notifications/{id}/read': { post: operation({ id: 'readNotification', summary: 'PER-19.A01. Marks only the recipient’s notification read.', tag: 'operations', permission: 'self', params: [uuidParam('id', 'Notification identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', additionalProperties: true }) } }) },
  '/me/notifications/read-all': { post: operation({ id: 'readAllNotifications', summary: 'PER-19.A02. Marks through a caller-supplied timestamp so a newly arriving notification is not silently swallowed.', tag: 'operations', permission: 'self', body: { type: 'object', required: ['through'], additionalProperties: false, properties: { through: { type: 'string', format: 'date-time' } } }, success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', additionalProperties: true }) } }) },
  '/follows': { post: operation({ id: 'followSubject', summary: 'Follows one public organisation or project by its public slug (or internal id). The unique key makes retries idempotent.', tag: 'operations', permission: 'self', body: { type: 'object', required: ['subjectType'], additionalProperties: false, properties: { subjectType: { type: 'string', enum: ['organization', 'project'] }, subjectId: { type: 'string', format: 'uuid' }, subjectSlug: { type: 'string', minLength: 1, maxLength: 90 } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', additionalProperties: true }) } }) },
  '/me/follows': { get: operation({ id: 'listMyFollows', summary: 'Lists the signed-in user’s followed resources.', tag: 'operations', permission: 'self', success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'array', items: { type: 'object', additionalProperties: true } }) } }) },
  '/follows/{id}': { delete: operation({ id: 'unfollowSubject', summary: 'PER-19.A04. Removes only the caller’s follow and changes no contribution or application.', tag: 'operations', permission: 'self', params: [uuidParam('id', 'Follow identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', additionalProperties: true }) } }) },
  '/admin/tickets': { get: operation({ id: 'listSupportQueue', summary: 'ADM-07. Scoped queue for active Support, RiskReviewer or PlatformAdmin grants.', tag: 'operations', permission: 'support.manage', success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'array', items: { type: 'object', additionalProperties: true } }) } }) },
  '/admin/tickets/{id}/claim': { post: operation({ id: 'claimSupportTicket', summary: 'Claims an unassigned ticket atomically at one version.', tag: 'operations', permission: 'support.manage', params: [uuidParam('id', 'Ticket identifier.')], body: versionBody('Ticket version.'), success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', additionalProperties: true }) } }) },
  '/admin/tickets/{id}/escalate': { post: operation({ id: 'escalateSupportTicket', summary: 'ADM-07.A02. Names priority and the next action time rather than promising an unstated SLA.', tag: 'operations', permission: 'support.manage', params: [uuidParam('id', 'Ticket identifier.')], body: { type: 'object', required: ['priority', 'nextActionAt', 'version'], additionalProperties: false, properties: { priority: { type: 'string', enum: ['high', 'urgent'] }, nextActionAt: { type: 'string', format: 'date-time' }, version: { type: 'integer', minimum: 1 } } }, success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', additionalProperties: true }) } }) },
  '/admin/tickets/{id}/resolve': { post: operation({ id: 'resolveSupportTicket', summary: 'ADM-07.A05. Resolution requires a code and explanation; it changes no financial right.', tag: 'operations', permission: 'support.manage', params: [uuidParam('id', 'Ticket identifier.')], body: { type: 'object', required: ['resolutionCode', 'resolution', 'version'], additionalProperties: false, properties: { resolutionCode: { type: 'string', minLength: 2, maxLength: 50 }, resolution: { type: 'string', minLength: 10, maxLength: 2000 }, version: { type: 'integer', minimum: 1 } } }, success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', additionalProperties: true }) } }) },
  '/admin/audit': { get: operation({ id: 'readAuditEvents', summary: 'ADM-08.A01. Redacted immutable audit projection for Auditor or PlatformAdmin.', tag: 'operations', permission: 'audit.read', query: [{ name: 'organizationId', description: 'Optional organisation scope.' }, { name: 'action', description: 'Exact action filter.' }, { name: 'take', description: '1–200 newest events.' }], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'array', items: { type: 'object', additionalProperties: true } }) } }) },
  '/admin/audit/{id}': { get: operation({ id: 'readAuditEvent', summary: 'ADM-08.A01. Opens one redacted immutable audit event.', tag: 'operations', permission: 'audit.read', params: [uuidParam('id', 'Audit event identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', additionalProperties: true }) } }) },
  '/admin/audit-exports': { post: operation({ id: 'requestAuditExport', summary: 'ADM-08.A02. Creates a reasoned, scoped CSV export job. Spreadsheet formula prefixes are neutralized and the ready file expires.', tag: 'operations', permission: 'audit.export', body: { type: 'object', required: ['reason'], additionalProperties: false, properties: { reason: { type: 'string', minLength: 10, maxLength: 2000 }, organizationId: { type: 'string', format: 'uuid' }, action: { type: 'string', maxLength: 64 } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', additionalProperties: true }) } }) },
  '/me/contribution-exports': { post: operation({ id: 'requestContributionExport', summary: 'PER-02.A02. Creates a private, expiring CSV snapshot of only the caller’s contributions.', tag: 'operations', permission: 'self', success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', additionalProperties: true }) } }) },
  '/me/investment-exports': { post: operation({ id: 'requestInvestmentExport', summary: 'PER-06.A02. Creates a private, expiring CSV snapshot of only the caller’s commitments and proven allocations.', tag: 'operations', permission: 'self', success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', additionalProperties: true }) } }) },
  '/me/notification-preferences': {
    get: operation({ id: 'getNotificationPreferences', summary: 'Reads optional email preferences. Mandatory in-app operational notifications remain enabled.', tag: 'operations', permission: 'self', success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', additionalProperties: true }) } }),
    post: operation({ id: 'updateNotificationPreferences', summary: 'Updates optional reminders and follow-update email choices with optimistic concurrency.', tag: 'operations', permission: 'self', body: { type: 'object', required: ['emailReminders', 'emailFollowUpdates', 'version'], additionalProperties: false, properties: { emailReminders: { type: 'boolean' }, emailFollowUpdates: { type: 'boolean' }, version: { type: 'integer', minimum: 1 } } }, success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', additionalProperties: true }) } })
  },
  '/me/data-exports/challenge': { post: operation({ id: 'createDataExportChallenge', summary: 'Starts a five-minute MFA-bound re-authentication for an account data export.', tag: 'operations', permission: 'self', success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', additionalProperties: true }) } }) },
  '/me/data-exports': { post: operation({ id: 'requestDataExport', summary: 'PER-18.A04. Consumes a verified MFA challenge and creates a private, expiring JSON account snapshot.', tag: 'operations', permission: 'self', body: { type: 'object', required: ['mfaChallengeId'], additionalProperties: false, properties: { mfaChallengeId: { type: 'string', format: 'uuid' } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', additionalProperties: true }) } }) },
  '/orgs/{id}/contribution-exports': { post: operation({ id: 'requestOrganizationContributionExport', summary: 'ORG-09.A02. Creates an expiring, redacted contribution CSV with no contributor identity.', tag: 'operations', permission: 'finance.export', params: [uuidParam('id', 'Organisation identifier.')], body: { type: 'object', required: ['projectId'], additionalProperties: false, properties: { projectId: { type: 'string', format: 'uuid' } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', additionalProperties: true }) } }) },
  '/orgs/{id}/ledger-exports': { post: operation({ id: 'requestOrganizationLedgerExport', summary: 'ORG-10.A04. Creates an expiring journal snapshot from append-only ledger entries.', tag: 'operations', permission: 'finance.export', params: [uuidParam('id', 'Organisation identifier.')], body: { type: 'object', required: ['projectId'], additionalProperties: false, properties: { projectId: { type: 'string', format: 'uuid' } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', additionalProperties: true }) } }) },
  '/contributions/{id}/receipt': { get: operation({ id: 'downloadContributionReceipt', summary: 'PER-03.A01. Returns a private receipt snapshot only to the contributor and only after confirmation.', tag: 'operations', permission: 'self', params: [uuidParam('id', 'Contribution identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', additionalProperties: true }) } }) },
  '/allocations/{id}/proof': { get: operation({ id: 'downloadAllocationProof', summary: 'PER-09.A01. Returns the immutable allocation evidence only to its holder.', tag: 'operations', permission: 'self', params: [uuidParam('id', 'Allocation identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', additionalProperties: true }) } }) },
  '/orgs/{id}/offerings/{oid}/allocation-exports': { post: operation({ id: 'requestAllocationBookExport', summary: 'BUS-04.A03. Creates a private, expiring subscriber and allocation snapshot.', tag: 'operations', permission: 'investment.export', params: [uuidParam('id', 'Organisation identifier.'), uuidParam('oid', 'Offering identifier.')], success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', additionalProperties: true }) } }) },
  '/orgs/{id}/application-exports': { post: operation({ id: 'requestApplicationExport', summary: 'PRG-03.A05. Creates a consent-aware candidate export; withheld profiles and contact fields remain blank.', tag: 'operations', permission: 'candidate.export', params: [uuidParam('id', 'Organisation identifier.')], body: { type: 'object', additionalProperties: false, properties: { applicationId: { type: 'string', format: 'uuid' } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', additionalProperties: true }) } }) },
  '/policies/{slug}/versions/{version}': { get: operation({ id: 'getPolicyVersion', summary: 'PUB-13.A02. Returns an immutable published policy version; unknown slugs or versions are absent.', tag: 'operations', permission: 'public', public: true, params: [tokenParam('slug', 'Policy slug.'), tokenParam('version', 'Published policy version.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', additionalProperties: true }) } }) },
  '/exports/{id}': { get: operation({ id: 'getExportJob', summary: 'SUP-05.A01. Rechecks current ownership and returns export state.', tag: 'operations', permission: 'self', params: [uuidParam('id', 'Export job identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', additionalProperties: true }) } }) },
  '/exports/{id}/download': { get: operation({ id: 'downloadExport', summary: 'SUP-05.A02. Returns content only while ready, unrevoked, unexpired and still owned by the caller.', tag: 'operations', permission: 'self', params: [uuidParam('id', 'Export job identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', additionalProperties: true }) } }) },
  '/exports/{id}/regenerate': { post: operation({ id: 'regenerateExport', summary: 'SUP-05.A03. Creates a new job from a failed or expired export after rechecking its original permission.', tag: 'operations', permission: 'self', params: [uuidParam('id', 'Export job identifier.')], success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', additionalProperties: true }) } }) },
  '/exports/{id}/revoke': { post: operation({ id: 'revokeExport', summary: 'SUP-05.A04. Revokes and clears the generated copy without deleting source records.', tag: 'operations', permission: 'self', params: [uuidParam('id', 'Export job identifier.')], body: versionBody('Export version.'), success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', additionalProperties: true }) } }) },
  '/public-reports': { get: operation({ id: 'listPublicReports', summary: 'Lists published redacted impact snapshots with period, currency and filter definitions. An optional organization slug scopes the public list without exposing private source records.', tag: 'operations', permission: 'public', public: true, query: [{ name: 'organizationSlug', description: 'Optional public organisation slug.', required: false }], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'array', items: { type: 'object', additionalProperties: true } }) } }) },
  '/public-reports/{id}': { get: operation({ id: 'getPublicReport', summary: 'SUP-04. Reads one immutable public impact snapshot, never its private source.', tag: 'operations', permission: 'public', public: true, params: [uuidParam('id', 'Public report identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', additionalProperties: true }) } }) },
  '/public-reports/{id}/download': { get: operation({ id: 'downloadPublicReport', summary: 'SUP-04.A01. Downloads only the published redacted snapshot.', tag: 'operations', permission: 'public', public: true, params: [uuidParam('id', 'Public report identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', additionalProperties: true }) } }) },
  '/admin/operations': { get: operation({ id: 'getOperationsOverview', summary: 'ADM-09. Queue counts, dead letters, open incidents and worker freshness without secrets or payloads.', tag: 'operations', permission: 'ops.read', success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', additionalProperties: true }) } }) },
  '/admin/jobs/{id}/retry': { post: operation({ id: 'retryOperationalJob', summary: 'ADM-09.A01. Requeues only a failed non-financial notification or export job. Financial unknown outcomes use inquiry instead.', tag: 'operations', permission: 'ops.jobs.manage', params: [uuidParam('id', 'Job identifier.')], body: { type: 'object', required: ['kind'], additionalProperties: false, properties: { kind: { type: 'string', enum: ['notification', 'export'] } } }, success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', additionalProperties: true }) } }) },
  '/admin/incidents/{id}': { get: operation({ id: 'getOperationalIncident', summary: 'ADM-09.A02. Reads one redacted incident record.', tag: 'operations', permission: 'ops.read', params: [uuidParam('id', 'Incident identifier.')], success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', additionalProperties: true }) } }) },
  '/admin/feature-flags/{id}/change-requests': { post: operation({ id: 'requestFeatureFlagChange', summary: 'ADM-09.A03. Records an audited request; it does not directly enable money or investment.', tag: 'operations', permission: 'platform.release.manage', params: [{ name: 'id', description: 'Allowlisted feature flag.' }], body: { type: 'object', required: ['desired', 'reason'], additionalProperties: false, properties: { desired: { type: 'boolean' }, reason: { type: 'string', minLength: 10, maxLength: 2000 } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', additionalProperties: true }) } }) },
  '/admin/restore-drills': { post: operation({ id: 'recordRestoreDrill', summary: 'ADM-09.A04. Records measured RPO/RTO and evidence from an actual restore drill.', tag: 'operations', permission: 'ops.manage', body: { type: 'object', required: ['environment', 'evidenceRef', 'measuredRpoMins', 'measuredRtoMins', 'outcome', 'performedAt'], additionalProperties: false, properties: { environment: { type: 'string' }, evidenceRef: { type: 'string' }, measuredRpoMins: { type: 'integer', minimum: 0 }, measuredRtoMins: { type: 'integer', minimum: 0 }, outcome: { type: 'string', enum: ['passed', 'failed', 'partial'] }, notes: { type: 'string', maxLength: 2000 }, performedAt: { type: 'string', format: 'date-time' } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', additionalProperties: true }) } }) },
  '/admin/subjects/{id}/freeze': { post: operation({ id: 'freezeSubject', summary: 'ADM-07.A03. Freezes exactly collect, payout or publish, with a reason. Other scopes continue.', tag: 'operations', permission: 'risk.freeze', params: [uuidParam('id', 'Subject identifier.')], body: { type: 'object', required: ['subjectType', 'scope', 'reason'], additionalProperties: false, properties: { subjectType: { type: 'string', minLength: 2, maxLength: 40 }, scope: { type: 'string', enum: ['collect', 'payout', 'publish'] }, reason: { type: 'string', minLength: 10, maxLength: 2000 } } }, success: { status: 201, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', additionalProperties: true }) } }) },
  '/admin/subjects/{id}/unfreeze': { post: operation({ id: 'unfreezeSubject', summary: 'ADM-07.A04. Independent reviewer clears one freeze with a reason; nothing republishes automatically.', tag: 'operations', permission: 'risk.unfreeze', params: [uuidParam('id', 'Subject identifier.')], body: { type: 'object', required: ['freezeId', 'reason', 'version'], additionalProperties: false, properties: { freezeId: { type: 'string', format: 'uuid' }, reason: { type: 'string', minLength: 10, maxLength: 2000 }, version: { type: 'integer', minimum: 1 } } }, success: { status: 200, description: ENVELOPE_DESCRIPTION, schema: envelope({ type: 'object', additionalProperties: true }) } }) },
} as const;

export const openapi = {
  openapi: '3.1.0',
  info: {
    title: 'Tamkeen API',
    version: '0.2.0',
    summary: 'Identity, organisations, verification and platform operations implemented for PART-02.',
    description: [
      'Local development contract. No money movement, payment provider, external email or investment',
      'capability exists behind these routes; MONEY_ENABLED and INVESTMENT_ENABLED are refused at startup.',
      '',
      'Conventions (11-API-CONTRACTS): JSON UTF-8; an opaque HttpOnly session cookie; a same-origin check',
      'on every mutation; permission, ownership and resource state re-checked server side on every call,',
      'including reads, and never trusted from a client-supplied organisation identifier.'
    ].join('\n')
  },
  servers: [{ url: '/api/v1', description: 'Versioned base path.' }],
  tags: [
    { name: 'health', description: 'Liveness and readiness.' },
    { name: 'auth', description: 'Credentials, email verification, recovery and second factor.' },
    { name: 'identity', description: 'The signed-in human, profile, context and sessions.' },
    { name: 'mfa', description: 'Step-up challenges for sensitive operations.' },
    { name: 'organizations', description: 'Organisation records, public projection and logo.' },
    { name: 'verification', description: 'Organisation verification drafts, documents and submissions.' },
    { name: 'team', description: 'Membership and invitations.' },
    { name: 'ownership', description: 'Organisation ownership transfer.' },
    { name: 'bank', description: 'Organisation bank account changes, reviewed independently.' },
    { name: 'admin', description: 'Platform operations, held to separate time-boxed grants.' },
    { name: 'projects', description: 'Projects across all three tracks, their public projection and the map.' },
    { name: 'charity', description: 'Campaigns, budgets, milestones and reports for the charity track.' },
    { name: 'programs', description: 'Training programmes, cohorts, applications, enrolment and attendance. A job is a separate thing, and this tag never creates one.' },
    { name: 'employment', description: 'Jobs, referrals, offers, placements and follow-up. An accepted offer is not an employment, and a follow-up nobody answered is unknown rather than success.' },
    { name: 'enablement', description: 'Agreements and grants, stipends and certificates, incubation, assistance and volunteering. A grant creates no equity, approving a deliverable releases no money, and an assistance record reaches no sponsor and no export.' },
    { name: 'operations', description: 'Private support, notification outbox, redacted audit access and narrowly scoped risk freezes.' }
  ],
  components: {
    securitySchemes: {
      sessionCookie: { type: 'apiKey', in: 'cookie', name: 'better-auth.session_token', description: 'Opaque session cookie. The server stores only its SHA-256 digest (ADR-012).' }
    },
    schemas
  },
  security: [{ sessionCookie: [] }],
  paths
} as const;

export type OpenApiDocument = typeof openapi;

/** Every documented operation as `METHOD /path`, used by the drift test and by tooling. */
export function documentedOperations(): Array<{ method: HttpMethod; path: string; operationId: string }> {
  const methods: HttpMethod[] = ['get', 'post', 'put', 'patch', 'delete'];
  const entries: Array<{ method: HttpMethod; path: string; operationId: string }> = [];
  for (const [path, item] of Object.entries(openapi.paths as Record<string, Record<string, { operationId: string }>>)) {
    for (const method of methods) {
      const op = item[method];
      if (op) entries.push({ method, path, operationId: op.operationId });
    }
  }
  return entries;
}

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertDelegation, assertPermission, permissionsFor } from '../apps/api/src/modules/identity/policy.js';

test('Owner has no implicit financial permissions or export permission', () => {
  const owner = permissionsFor(['Owner']);
  assert.equal(owner.has('payout.approve'), false);
  assert.equal(owner.has('payout.request'), false);
  assert.equal(owner.has('finance.read'), false);
});
test('role delegation cannot manufacture permissions or assign ownership', () => {
  assert.throws(() => assertDelegation(['Owner'], ['FinanceMaker']));
  assert.throws(() => assertDelegation(['OrgAdmin'], ['Owner']));
  assert.throws(() => assertDelegation(['Owner'], []));
  assert.throws(() => assertDelegation(['Owner'], ['Owner', 'Owner']));
  assert.doesNotThrow(() => assertDelegation(['OrgAdmin'], ['ProjectManager']));
});
test('same actor cannot approve own financial request despite both roles', () => {
  const base = { userStatus: 'active', organizationStatus: 'active', membershipStatus: 'active', roles: ['FinanceMaker', 'FinanceApprover'] as const, actorId: 'a', permission: 'payout.approve' as const };
  assert.throws(() => assertPermission({ ...base, makerId: 'a' }));
  assert.throws(() => assertPermission(base));
  assert.doesNotThrow(() => assertPermission({ ...base, makerId: 'b' }));
});
test('status restrictions override otherwise sufficient permissions', () => {
  const base = { userStatus: 'active', organizationStatus: 'active', membershipStatus: 'active', roles: ['Owner'] as const, actorId: 'a', permission: 'organization.read' as const };
  for (const field of ['userStatus', 'organizationStatus', 'membershipStatus'] as const) assert.throws(() => assertPermission({ ...base, [field]: 'suspended' }));
});

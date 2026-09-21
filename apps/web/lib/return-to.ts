/** Only known internal workspaces may be resumed after authentication. */
export function safeReturnTo(value: string | null): string {
  if (!value || /[\\\s?#%]/.test(value)) return '/app';
  if (['/app', '/onboarding', '/app/security', '/app/settings', '/app/organizations/new', '/admin/verifications', '/admin/bank-change-requests'].includes(value)) return value;
  if (/^\/org\/[a-f0-9-]{36}(\/(?:team|settings|verification))?$/.test(value)) return value;
  if (/^\/invitations\/[A-Za-z0-9_-]{32,128}$/.test(value)) return value;
  if (/^\/platform-invitations\/[A-Za-z0-9_-]{32,128}$/.test(value)) return value;
  if (/^\/ownership-transfers\/[A-Za-z0-9_-]{32,128}$/.test(value)) return value;
  if (/^\/admin\/verifications\/[a-f0-9-]{36}$/.test(value)) return value;
  return '/app';
}

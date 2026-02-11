import { getRequestEvent } from '$app/server';

export function assertAdminToken(token: string) {
  const event = getRequestEvent();
  const env = event.platform?.env;

  const candidateCf = env?.CF_ADMIN_TOKEN;
  const candidateAdmin = env?.ADMIN_TOKEN;
  const expected = candidateCf || (candidateAdmin && candidateAdmin !== 'CHANGE_ME' ? candidateAdmin : undefined);

  if (!expected) {
    throw new Error('ADMIN_TOKEN_NOT_CONFIGURED');
  }

  if (token !== expected) {
    throw new Error('UNAUTHORIZED');
  }
}

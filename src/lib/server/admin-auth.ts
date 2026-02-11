import { getRequestEvent } from '$app/server';

export function assertAdminToken(token: string) {
  const event = getRequestEvent();
  const expected = event.platform?.env?.ADMIN_TOKEN;

  if (!expected || expected === 'CHANGE_ME') {
    throw new Error('ADMIN_TOKEN_NOT_CONFIGURED');
  }

  if (token !== expected) {
    throw new Error('UNAUTHORIZED');
  }
}

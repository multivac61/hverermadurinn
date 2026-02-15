import { getRequestEvent } from '$app/server';

export function assertAdminToken(token: string) {
  const event = getRequestEvent();
  const expectedRaw = event.platform?.env?.ADMIN_TOKEN;
  const expected = typeof expectedRaw === 'string' ? expectedRaw.trim() : '';
  const provided = token.trim();

  if (!expected || expected === 'CHANGE_ME') {
    throw new Error('ADMIN_TOKEN_NOT_CONFIGURED');
  }

  if (!provided || provided !== expected) {
    throw new Error('UNAUTHORIZED');
  }
}

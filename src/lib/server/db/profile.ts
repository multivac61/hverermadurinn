import { eq } from 'drizzle-orm';
import { hashDeviceId, normalizeUsername } from '$lib/server/device';
import { usernames } from '$lib/server/db/schema';

type Db = any;

export async function getUsernameByDeviceId(db: Db, deviceId: string) {
  const deviceIdHash = hashDeviceId(deviceId);
  const [row] = await db.select().from(usernames).where(eq(usernames.deviceIdHash, deviceIdHash)).limit(1);
  return row?.username ?? null;
}

export async function setUsernameForDeviceId(db: Db, input: { deviceId: string; username: string }) {
  const username = input.username.trim();
  const usernameNormalized = normalizeUsername(username);
  const deviceIdHash = hashDeviceId(input.deviceId);

  const [existingByName] = await db
    .select()
    .from(usernames)
    .where(eq(usernames.usernameNormalized, usernameNormalized))
    .limit(1);

  if (existingByName && String(existingByName.deviceIdHash) !== String(deviceIdHash)) {
    throw new Error('USERNAME_TAKEN');
  }

  await db
    .insert(usernames)
    .values({
      deviceIdHash,
      username,
      usernameNormalized,
      updatedAt: new Date()
    })
    .onConflictDoUpdate({
      target: usernames.deviceIdHash,
      set: {
        username,
        usernameNormalized,
        updatedAt: new Date()
      }
    })
    .run();

  return { username };
}

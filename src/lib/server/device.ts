export function hashDeviceId(input: string) {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return String(Math.abs(h));
}

export function normalizeUsername(username: string) {
  return username.trim().toLowerCase().normalize('NFKC');
}

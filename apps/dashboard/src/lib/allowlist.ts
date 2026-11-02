const normalise = (email: string) => email.trim().toLowerCase();

/** `allowlist` is comma-separated. An empty list denies everyone. */
export function isAllowed(
  user: { email: string; emailVerified: boolean },
  allowlist: string,
): boolean {
  if (!user.emailVerified) return false;
  const email = normalise(user.email);
  return email !== '' && allowlist.split(',').map(normalise).includes(email);
}

import type { AccountUser, UserRole } from "./study/types.js";

export const AUTH_CAPABILITIES = [
  "site.settings.write",
  "messages.moderate",
  "messages.contact.read",
] as const;

export type AuthCapability = typeof AUTH_CAPABILITIES[number];

const ROLE_CAPABILITIES: Record<UserRole, readonly AuthCapability[]> = {
  user: [],
  admin: AUTH_CAPABILITIES,
};

export function capabilitiesFor(user: Pick<AccountUser, "role">): readonly AuthCapability[] {
  return ROLE_CAPABILITIES[user.role];
}

export function hasCapability(user: Pick<AccountUser, "role"> | null, capability: AuthCapability): boolean {
  return user !== null && ROLE_CAPABILITIES[user.role].includes(capability);
}

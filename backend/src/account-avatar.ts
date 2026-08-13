import { randomUUID } from "node:crypto";
import type { AccountAvatar, AccountAvatarInput, AccountAvatarMimeType } from "./study/types.js";

export const ACCOUNT_AVATAR_MAX_BYTES = 512 * 1024;
const MAX_BASE64_LENGTH = Math.ceil(ACCOUNT_AVATAR_MAX_BYTES / 3) * 4;
const ACCOUNT_AVATAR_VERSION_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

export function isAccountAvatarVersion(value: unknown): value is string {
  return typeof value === "string" && ACCOUNT_AVATAR_VERSION_PATTERN.test(value);
}

/** Community surfaces expose avatars by the current opaque version, never by account id. */
export function publicAvatarUrl(version: string | undefined): string | null {
  return version && isAccountAvatarVersion(version)
    ? `/api/avatars/${encodeURIComponent(version)}`
    : null;
}

export function parseAccountAvatarMimeType(value: string | undefined): AccountAvatarMimeType | null {
  const mimeType = value?.split(";", 1)[0]?.trim().toLowerCase();
  return mimeType === "image/jpeg" || mimeType === "image/png" || mimeType === "image/webp"
    ? mimeType
    : null;
}

export function hasAccountAvatarSignature(bytes: Uint8Array, mimeType: AccountAvatarMimeType): boolean {
  if (mimeType === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mimeType === "image/png") {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return bytes.length >= signature.length && signature.every((byte, index) => bytes[index] === byte);
  }
  return bytes.length >= 12
    && String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF"
    && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP";
}

export function createAccountAvatar(input: AccountAvatarInput, at: string): AccountAvatar {
  const avatar = { ...input, version: randomUUID(), updatedAt: at };
  if (!decodeAccountAvatar(avatar)) throw new TypeError("Account avatar payload is invalid");
  return avatar;
}

export function decodeAccountAvatar(avatar: AccountAvatar): Buffer | null {
  if (
    !parseAccountAvatarMimeType(avatar.mimeType)
    || typeof avatar.dataBase64 !== "string"
    || avatar.dataBase64.length === 0
    || avatar.dataBase64.length > MAX_BASE64_LENGTH
    || avatar.dataBase64.length % 4 !== 0
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(avatar.dataBase64)
    || !isAccountAvatarVersion(avatar.version)
    || typeof avatar.updatedAt !== "string"
    || !Number.isFinite(Date.parse(avatar.updatedAt))
  ) return null;
  const bytes = Buffer.from(avatar.dataBase64, "base64");
  if (bytes.length === 0 || bytes.length > ACCOUNT_AVATAR_MAX_BYTES) return null;
  return hasAccountAvatarSignature(bytes, avatar.mimeType) ? bytes : null;
}

export function isStoredAccountAvatar(value: unknown): value is AccountAvatar {
  if (!value || typeof value !== "object") return false;
  const avatar = value as Partial<AccountAvatar>;
  if (!avatar.mimeType || !avatar.dataBase64 || !avatar.version || !avatar.updatedAt) return false;
  return decodeAccountAvatar(avatar as AccountAvatar) !== null;
}

/** Invite codes are 8 letters and numbers; links may arrive lower-cased or with spaces. */
export const INVITE_CODE_RE = /^[A-Z0-9]{8}$/;

export function normaliseInviteCode(raw: string): string {
  let decoded = typeof raw === "string" ? raw : "";
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // Malformed escape: validated (and rejected) by INVITE_CODE_RE.
  }
  return decoded.replace(/\s/g, "").toUpperCase();
}

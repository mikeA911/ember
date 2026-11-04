// Accounts created with a temporary password (scripts/sli-add-members.mjs)
// carry user_metadata.must_change_password until the person chooses their
// own. The app layouts send them to /reset-password?first=1 until then.
// user_metadata is writable by the user, so this is a nudge, not a
// security control: the temporary password still works until changed.
export function mustChangePassword(user: { user_metadata?: Record<string, unknown> | null } | null | undefined): boolean {
  return user?.user_metadata?.must_change_password === true
}

export const FIRST_SIGN_IN_PATH = '/reset-password?first=1'

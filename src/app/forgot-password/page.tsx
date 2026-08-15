import { redirect } from "next/navigation";

// Owner mandate task-20260815-033857 (Z.ai black-box audit point P8-CB-10 /
// P1-OBS-003, governing UMR UMR-20260806-101802-a350): the login form
// offers no password-reset entry point (this app has no password-reset
// flow at all -- only Google/magic-link/passcode/SSO, see login-form.tsx),
// but /forgot-password returned a bare 404 instead of routing a visitor
// anywhere useful. Per the finding's own recommendation ("Implement
// /forgot-password OR redirect it to /login with a magic-link prompt"),
// this is the redirect option -- no new password-reset mechanism invented,
// consistent with this codebase's existing, deliberate choice not to build
// one (see passcode-login-service.ts's header: "never a recovery
// mechanism"). login-form.tsx reads ?reason=forgot-password to surface an
// inline prompt pointing at the existing "Send magic link instead" option.
export default function ForgotPasswordPage() {
  redirect("/login?reason=forgot-password");
}

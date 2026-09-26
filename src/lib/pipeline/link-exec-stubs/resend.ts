// Stub of the resend package for the ai-work-link-exec bundle: a link write sends no email.
import { thrower } from "./unavailable"
export const Resend = class {
  constructor(..._args: unknown[]) {
    thrower("resend")()
  }
}

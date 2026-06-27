import { getApiClient } from "../client";

export const onboardingEndpoints = {
  /** GET /api/onboarding/status — check onboarding progress */
  status: async () => {
    return getApiClient().get("onboarding/status").json<{
      success: boolean;
      data: {
        completed_steps: string[];
        current_step: number;
        is_complete: boolean;
      };
    }>();
  },
  /** POST /api/onboarding/complete-step — mark a step as done */
  completeStep: async (step: string, data?: Record<string, unknown>) => {
    return getApiClient().post("onboarding/complete-step", {
      json: { step, ...data },
    }).json<{ success: boolean }>();
  },
};
import type { FlowState } from "../flow/orchestrator";

export const KIOSK_PROGRESS_STEPS = [
  { key: "recommend", label: "Menu" },
  { key: "options", label: "Options" },
  { key: "fulfillment", label: "Place" },
  { key: "loyalty", label: "Points" },
  { key: "payment", label: "Pay" },
  { key: "confirm", label: "Review" },
] as const satisfies readonly { key: FlowState["step"]; label: string }[];

export function progressIndexForStep(step: FlowState["step"]): number {
  return KIOSK_PROGRESS_STEPS.findIndex((entry) => entry.key === step);
}

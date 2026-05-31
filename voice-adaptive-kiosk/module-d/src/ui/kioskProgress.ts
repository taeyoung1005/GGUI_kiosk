import type { FlowState } from "../flow/orchestrator";

export const KIOSK_PROGRESS_STEPS = [
  { key: "recommend", label: "메뉴" },
  { key: "options", label: "옵션" },
  { key: "fulfillment", label: "장소" },
  { key: "loyalty", label: "적립" },
  { key: "payment", label: "결제" },
  { key: "confirm", label: "확인" },
] as const satisfies readonly { key: FlowState["step"]; label: string }[];

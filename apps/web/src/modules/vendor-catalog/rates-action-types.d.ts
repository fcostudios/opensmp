export type RateActionState = { status: "idle" | "success" | "error"; id?: string };
export type RateAction = (state: RateActionState, data: FormData) => Promise<RateActionState>;

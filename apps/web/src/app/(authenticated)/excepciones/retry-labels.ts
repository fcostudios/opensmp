export function retryErrorMessageKey(value: string | undefined) {
  if (value === "conflict") return "retryConflict" as const;
  if (value === "invalid") return "retryInvalid" as const;
  return null;
}

export function failedInviteLabels(
  translate: (
    key: "exceptionAutomated" | "exceptionInvite" | "retryingProvisioning",
  ) => string,
) {
  return {
    kindInvite: translate("exceptionInvite"),
    modeAutomated: translate("exceptionAutomated"),
    retryingProvisioning: translate("retryingProvisioning"),
  };
}

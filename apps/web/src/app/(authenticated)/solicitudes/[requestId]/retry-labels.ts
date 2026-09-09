export function retryProvisioningLabels(
  translate: (key: "retryProvisioning" | "retryingProvisioning") => string,
) {
  return {
    retryProvisioning: translate("retryProvisioning"),
    retryingProvisioning: translate("retryingProvisioning"),
  };
}

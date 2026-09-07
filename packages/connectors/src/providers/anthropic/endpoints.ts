export type AnthropicEndpoint =
  | "organization" | "members" | "invites" | "create_invite"
  | "delete_invite" | "delete_member" | "analytics_users" | "analytics_summaries"
  | "usage_report" | "user_usage_report" | "cost_report" | "user_cost_report";

export type AnthropicCredentialKind = "admin_scoped" | "analytics";

export type AnthropicBudgetKind = "user_management" | "analytics" | "invite_create";

export type AnthropicFailureClassification =
  | "rate_limited" | "provider_error" | "client_error" | "transport_ambiguous";

export type AnthropicEndpointPolicy = Readonly<{
  origin: "https://api.anthropic.com";
  method: "GET" | "POST" | "DELETE";
  path: string;
  anthropicVersion: "2023-06-01";
  requestMediaType: "application/json" | null;
  responseMediaType: "application/json";
  betaHeader: string | null;
  credentialKind: AnthropicCredentialKind;
  budgets: readonly AnthropicBudgetKind[];
  retrySafe: boolean;
}>;

export function anthropicFailureRetryable(
  policy: Pick<AnthropicEndpointPolicy, "retrySafe">,
  classification: AnthropicFailureClassification,
): boolean {
  return policy.retrySafe && (
    classification === "rate_limited"
    || classification === "provider_error"
    || classification === "transport_ambiguous"
  );
}

type ResourceAnthropicEndpoint = "delete_invite" | "delete_member";
type FixedAnthropicEndpoint = Exclude<AnthropicEndpoint, ResourceAnthropicEndpoint>;

function frozenPolicy(policy: AnthropicEndpointPolicy): AnthropicEndpointPolicy {
  return Object.freeze({
    ...policy,
    budgets: Object.freeze([...policy.budgets]),
  });
}

const FIXED_POLICIES: Readonly<Record<FixedAnthropicEndpoint, AnthropicEndpointPolicy>> =
  Object.freeze({
    organization: frozenPolicy({
      origin: "https://api.anthropic.com",
      method: "GET",
      path: "/v1/organizations/me",
      anthropicVersion: "2023-06-01",
      requestMediaType: null,
      responseMediaType: "application/json",
      betaHeader: null,
      credentialKind: "admin_scoped",
      budgets: ["user_management"],
      retrySafe: true,
    }),
    members: frozenPolicy({
      origin: "https://api.anthropic.com",
      method: "GET",
      path: "/v1/organizations/users",
      anthropicVersion: "2023-06-01",
      requestMediaType: null,
      responseMediaType: "application/json",
      betaHeader: null,
      credentialKind: "admin_scoped",
      budgets: ["user_management"],
      retrySafe: true,
    }),
    invites: frozenPolicy({
      origin: "https://api.anthropic.com",
      method: "GET",
      path: "/v1/organizations/invites",
      anthropicVersion: "2023-06-01",
      requestMediaType: null,
      responseMediaType: "application/json",
      betaHeader: null,
      credentialKind: "admin_scoped",
      budgets: ["user_management"],
      retrySafe: true,
    }),
    create_invite: frozenPolicy({
      origin: "https://api.anthropic.com",
      method: "POST",
      path: "/v1/organizations/invites",
      anthropicVersion: "2023-06-01",
      requestMediaType: "application/json",
      responseMediaType: "application/json",
      betaHeader: null,
      credentialKind: "admin_scoped",
      budgets: ["user_management", "invite_create"],
      retrySafe: false,
    }),
    analytics_users: frozenPolicy({
      origin: "https://api.anthropic.com",
      method: "GET",
      path: "/v1/organizations/analytics/users",
      anthropicVersion: "2023-06-01",
      requestMediaType: null,
      responseMediaType: "application/json",
      betaHeader: null,
      credentialKind: "analytics",
      budgets: ["analytics"],
      retrySafe: true,
    }),
    analytics_summaries: frozenPolicy({
      origin: "https://api.anthropic.com",
      method: "GET",
      path: "/v1/organizations/analytics/summaries",
      anthropicVersion: "2023-06-01",
      requestMediaType: null,
      responseMediaType: "application/json",
      betaHeader: null,
      credentialKind: "analytics",
      budgets: ["analytics"],
      retrySafe: true,
    }),
    usage_report: frozenPolicy({
      origin: "https://api.anthropic.com",
      method: "GET",
      path: "/v1/organizations/analytics/usage_report",
      anthropicVersion: "2023-06-01",
      requestMediaType: null,
      responseMediaType: "application/json",
      betaHeader: null,
      credentialKind: "analytics",
      budgets: ["analytics"],
      retrySafe: true,
    }),
    user_usage_report: frozenPolicy({
      origin: "https://api.anthropic.com",
      method: "GET",
      path: "/v1/organizations/analytics/user_usage_report",
      anthropicVersion: "2023-06-01",
      requestMediaType: null,
      responseMediaType: "application/json",
      betaHeader: null,
      credentialKind: "analytics",
      budgets: ["analytics"],
      retrySafe: true,
    }),
    cost_report: frozenPolicy({
      origin: "https://api.anthropic.com",
      method: "GET",
      path: "/v1/organizations/analytics/cost_report",
      anthropicVersion: "2023-06-01",
      requestMediaType: null,
      responseMediaType: "application/json",
      betaHeader: null,
      credentialKind: "analytics",
      budgets: ["analytics"],
      retrySafe: true,
    }),
    user_cost_report: frozenPolicy({
      origin: "https://api.anthropic.com",
      method: "GET",
      path: "/v1/organizations/analytics/user_cost_report",
      anthropicVersion: "2023-06-01",
      requestMediaType: null,
      responseMediaType: "application/json",
      betaHeader: null,
      credentialKind: "analytics",
      budgets: ["analytics"],
      retrySafe: true,
    }),
  });

export function endpointPolicy(
  endpoint: AnthropicEndpoint,
  parameters?: Readonly<{ resourceId?: string }>,
): AnthropicEndpointPolicy {
  if (endpoint === "delete_invite" || endpoint === "delete_member") {
    const resourceId = parameters?.resourceId;
    if (typeof resourceId !== "string" || resourceId.trim().length === 0) {
      throw new Error("Anthropic delete invite policy requires resourceId.");
    }
    const normalizedResourceId = resourceId.trim();
    if (normalizedResourceId === "." || normalizedResourceId === "..") {
      throw new Error("Anthropic delete invite policy requires resourceId.");
    }
    return frozenPolicy({
      origin: "https://api.anthropic.com",
      method: "DELETE",
      path: `/v1/organizations/${endpoint === "delete_invite" ? "invites" : "users"}/${encodeURIComponent(normalizedResourceId)}`,
      anthropicVersion: "2023-06-01",
      requestMediaType: null,
      responseMediaType: "application/json",
      betaHeader: null,
      credentialKind: "admin_scoped",
      budgets: ["user_management"],
      retrySafe: true,
    });
  }

  const policy = FIXED_POLICIES[endpoint as FixedAnthropicEndpoint];
  if (!policy) throw new Error("Unsupported Anthropic endpoint.");
  return frozenPolicy(policy);
}

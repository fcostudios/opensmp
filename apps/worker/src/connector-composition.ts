import { createConnectorDispatcher } from "@smp/connectors";
import { createAnthropicConnector } from "@smp/connectors/providers/anthropic/connector";

export {
  createAnthropicConnector as createProvisioningConnector,
} from "@smp/connectors/providers/anthropic/connector";
export {
  createAnthropicRateLimiter as createProvisioningRateLimiter,
} from "@smp/connectors/providers/anthropic/rate-limiter";

/** Register shipped capabilities without configuring or invoking remote operations. */
export function createProvisioningPlanningDispatcher() {
  return createConnectorDispatcher({ rest: createAnthropicConnector() });
}

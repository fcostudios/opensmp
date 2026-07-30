import {
  createAlertNotificationOutbox,
  type AlertEventInput,
} from "@smp/notifications/outbox";
import pg from "pg";

import {
  countAuthorizedAlertEvents,
  listAuthorizedAlertEvents,
  type AlertEventCounts,
  type AlertEventPage,
  type AlertReadOptions,
} from "../operational-alert-read";

export type { AlertEventInput };
export {
  parseAlertCursor,
  serializeAlertCursor,
  type AlertEventPage,
  type AlertReadFilter,
  type AlertReadOptions,
  type CompanyAlertEvent,
} from "../operational-alert-read";

export type AlertRepository = {
  close(): Promise<void>;
  createEvent(input: AlertEventInput): Promise<
    | { id: string; status: "created" }
    | { id: string; status: "replayed" }
  >;
  countAuthorizedEvents(
    authorization: Parameters<typeof countAuthorizedAlertEvents>[1],
  ): Promise<AlertEventCounts>;
  listAuthorizedEvents(
    authorization: Parameters<typeof listAuthorizedAlertEvents>[1],
    options?: AlertReadOptions,
  ): Promise<AlertEventPage>;
};

export function createAlertRepository(connectionString: string): AlertRepository {
  const outbox = createAlertNotificationOutbox(connectionString);
  const pool = new pg.Pool({ connectionString });
  return {
    close: async () => {
      await Promise.all([outbox.close(), pool.end()]);
    },

    createEvent: async (input) => await outbox.enqueue(input),

    async countAuthorizedEvents(authorization) {
      return countAuthorizedAlertEvents(pool, authorization);
    },

    async listAuthorizedEvents(authorization, options = {}) {
      return listAuthorizedAlertEvents(pool, authorization, options);
    },
  };
}

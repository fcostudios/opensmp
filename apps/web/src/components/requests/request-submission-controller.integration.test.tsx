// @vitest-environment jsdom

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";

import { submitRequestSchema, type SubmitRequestInput } from "@smp/contracts";
import * as schema from "@smp/db/schema";
import {
  createPostgresFixture,
  type PostgresFixture,
} from "@smp/db/testing/postgres-container";

import { createAuthorizationRepository } from "@/modules/identity-access/authorization";
import { submitRequestPolicy } from "@/modules/request-workflow/actions/submit-request-policy";
import { createRequestRepository } from "@/modules/request-workflow/repository";
import {
  useRequestSubmissionController,
  type RequestExecutor,
} from "./request-submission-controller";

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
}));

const ids = {
  admin: "13000000-0000-4000-8000-000000000001",
  employee: "13000000-0000-4000-8000-000000000002",
  viewer: "13000000-0000-4000-8000-000000000003",
  company: "13000000-0000-4000-8000-000000000004",
  person: "13000000-0000-4000-8000-000000000005",
  vendor: "13000000-0000-4000-8000-000000000006",
  account: "13000000-0000-4000-8000-000000000007",
  license: "13000000-0000-4000-8000-000000000008",
} as const;
const now = new Date("2026-07-28T18:00:00.000Z");

let fixture: PostgresFixture;
let owner: pg.Client;
let pool: pg.Pool;
let database: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  fixture = await createPostgresFixture();
  await fixture.migrate();
  owner = await fixture.connectAsOwner();
  pool = new pg.Pool({ connectionString: fixture.appUrl });
  database = drizzle(pool, { schema });
});

afterAll(async () => {
  await pool.end();
  await owner.end();
  await fixture.stop();
});

beforeEach(async () => {
  navigation.push.mockReset();
  await owner.query(
    `TRUNCATE TABLE audit_log, request_transition, license_request, rate_card,
      license_assignment, license_type, vendor_account, vendor,
      company_role_assignment, person, company, user_account
      RESTART IDENTITY CASCADE`,
  );
  await owner.query(
    `INSERT INTO user_account
       (id,email,idp_subject,global_role,ui_language,status,created_at)
     VALUES
       ($1,'admin@ledger.test','controller-admin','group_admin','es','active',$4),
       ($2,'employee@acme.test','controller-employee',NULL,'es','active',$4),
       ($3,'viewer@acme.test','controller-viewer',NULL,'es','active',$4)`,
    [ids.admin, ids.employee, ids.viewer, now],
  );
  await owner.query(
    `INSERT INTO company
       (id,name,code,type,status,finance_contact_email,statement_language,
        created_at,created_by)
     VALUES ($1,'Acme','ACME','internal','active','finance@acme.test','es',$2,$3)`,
    [ids.company, now, ids.admin],
  );
  await owner.query(
    `INSERT INTO person
       (id,email,full_name,company_id,status,created_at,created_by)
     VALUES ($1,'employee@acme.test','Employee',$2,'active',$3,$4)`,
    [ids.person, ids.company, now, ids.admin],
  );
  await owner.query(
    `UPDATE user_account SET person_id=$1 WHERE id=$2`,
    [ids.person, ids.employee],
  );
  await owner.query(
    `INSERT INTO company_role_assignment
       (user_account_id,company_id,role,unique_grant,created_at,created_by)
     VALUES ($1,$2,'viewer','controller-viewer-a',$3,$4)`,
    [ids.viewer, ids.company, now, ids.admin],
  );
  await owner.query(
    `INSERT INTO vendor
       (id,name,connector_type,provisioning_protocol,can_provision,can_deprovision,
        has_usage_data,has_cost_data,identity_matching,status,created_at,created_by)
     VALUES ($1,'Anthropic','orchestration','none',false,false,false,false,
       'email','active',$2,$3)`,
    [ids.vendor, now, ids.admin],
  );
  await owner.query(
    `INSERT INTO vendor_account
       (id,vendor_id,name,mode,low_pool_floor,status,created_at,created_by)
     VALUES ($1,$2,'Claude Org','orchestration',1,'active',$3,$4)`,
    [ids.account, ids.vendor, now, ids.admin],
  );
  await owner.query(
    `INSERT INTO license_type
       (id,vendor_id,name,unit,status,created_at,created_by)
     VALUES ($1,$2,'Claude Team','seat','active',$3,$4)`,
    [ids.license, ids.vendor, now, ids.admin],
  );
  window.history.replaceState(null, "", "/solicitudes/nueva");
});

afterEach(cleanup);

function Harness({ execute }: { readonly execute: RequestExecutor }) {
  const controller = useRequestSubmissionController({ execute });
  return (
    <form onSubmit={controller.submit}>
      <input name="vendorAccountId" value={ids.account} readOnly />
      <input name="licenseTypeId" value={ids.license} readOnly />
      <input name="justification" value="Real boundary request" readOnly />
      <button disabled={controller.pending || controller.succeeded} type="submit">
        {"submit"}
      </button>
      <output>{controller.result?.ok ? "success" : controller.result?.error}</output>
    </form>
  );
}

function realExecutor(
  subject: "controller-employee" | "controller-viewer",
  observed: SubmitRequestInput[] = [],
): RequestExecutor {
  const authorization = createAuthorizationRepository(database);
  const repository = createRequestRepository(database);
  return async (input) => {
    observed.push(submitRequestSchema.parse(input));
    return submitRequestPolicy({
      input,
      loadAuthorization: authorization.load,
      occurredAt: now,
      recordAuthorizationFailure: authorization.recordAuthorizationFailure,
      repository,
      subject,
    });
  };
}

describe("request submission controller real boundary", () => {
  test("retries a real database failure with one key, persists, locks, and navigates", async () => {
    await owner.query(
      `CREATE FUNCTION controller_reject_request() RETURNS trigger
       LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'real failure'; END $$;
       CREATE TRIGGER controller_reject_request
       BEFORE INSERT ON license_request
       FOR EACH ROW EXECUTE FUNCTION controller_reject_request()`,
    );
    const observed: SubmitRequestInput[] = [];
    render(<Harness execute={realExecutor("controller-employee", observed)} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "submit" }));
    expect(await screen.findByText("submission_failed")).toBeTruthy();
    await owner.query(
      `DROP TRIGGER controller_reject_request ON license_request;
       DROP FUNCTION controller_reject_request()`,
    );
    const form = screen.getByRole("button", { name: "submit" }).closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(
      (screen.getByRole("button", { name: "submit" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    await screen.findByText("success");
    expect(observed).toHaveLength(2);
    expect(observed[1]!.clientRequestId).toBe(observed[0]!.clientRequestId);
    await waitFor(() =>
      expect(navigation.push).toHaveBeenCalledWith(
        expect.stringMatching(/^\/solicitudes\/[0-9a-f-]+\?created=1$/),
      ),
    );
    expect(
      (screen.getByRole("button", { name: "submit" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (await owner.query(`SELECT count(*)::int AS count FROM license_request`))
        .rows[0]?.count,
    ).toBe(1);
    fireEvent.submit(form);
    expect(observed).toHaveLength(2);
  });

  test("renders a real forbidden result with one denial audit and no request", async () => {
    const historyLength = window.history.length;
    render(<Harness execute={realExecutor("controller-viewer")} />);
    await userEvent.click(screen.getByRole("button", { name: "submit" }));
    expect(await screen.findByText("forbidden")).toBeTruthy();
    expect(navigation.push).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe("/solicitudes/nueva");
    expect(window.history.length).toBe(historyLength);
    expect(
      (screen.getByRole("button", { name: "submit" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    expect(
      (
        await owner.query(
          `SELECT
             (SELECT count(*)::int FROM license_request) AS requests,
             (SELECT count(*)::int FROM audit_log
              WHERE action='authorization.denied') AS denials`,
        )
      ).rows,
    ).toEqual([{ requests: 0, denials: 1 }]);
  });

  test("normalizes a thrown real database boundary failure", async () => {
    const closedPool = new pg.Pool({ connectionString: fixture.appUrl });
    const closedDatabase = drizzle(closedPool, { schema });
    const authorization = createAuthorizationRepository(closedDatabase);
    const repository = createRequestRepository(closedDatabase);
    await closedPool.end();
    const execute: RequestExecutor = (input) =>
      submitRequestPolicy({
        input,
        loadAuthorization: authorization.load,
        occurredAt: now,
        recordAuthorizationFailure: authorization.recordAuthorizationFailure,
        repository,
        subject: "controller-employee",
      });

    render(<Harness execute={execute} />);
    await userEvent.click(screen.getByRole("button", { name: "submit" }));

    expect(await screen.findByText("submission_failed")).toBeTruthy();
    expect(navigation.push).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe("/solicitudes/nueva");
    expect(
      (await owner.query(`SELECT count(*)::int AS count FROM license_request`))
        .rows[0]?.count,
    ).toBe(0);
  });
});

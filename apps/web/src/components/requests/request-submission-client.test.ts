import { describe, expect, test } from "vitest";

import {
  createdRequestUrl,
  nextRequestAttempt,
  requestInputFromForm,
  submissionAllowed,
  submissionSettlement,
} from "./request-submission-client";

describe("request submission client state", () => {
  test("reuses a key for an exact transport retry and rotates it after semantic edits", () => {
    const generated = [
      "12000000-0000-4000-8000-000000000301",
      "12000000-0000-4000-8000-000000000302",
    ];
    let index = 0;
    const generate = () => generated[index++]!;
    const semantic = {
      requestFor: "self",
      justification: "Retry me",
    };
    const first = nextRequestAttempt(semantic, null, generate);
    const retry = nextRequestAttempt(semantic, first, generate);
    const edited = nextRequestAttempt(
      { ...semantic, justification: "Changed" },
      retry,
      generate,
    );

    expect(first.clientRequestId).toBe(generated[0]);
    expect(retry).toEqual(first);
    expect(edited.clientRequestId).toBe(generated[1]);
    expect(index).toBe(2);
  });

  test("builds the non-sensitive created destination exactly", () => {
    expect(
      createdRequestUrl(
        "/solicitudes/12000000-0000-4000-8000-000000000303",
      ),
    ).toBe(
      "/solicitudes/12000000-0000-4000-8000-000000000303?created=1",
    );
  });

  test("serializes self and on-behalf form semantics before adding the retry key", () => {
    const form = new FormData();
    form.set("vendorAccountId", "vendor-id");
    form.set("licenseTypeId", "license-id");
    form.set("justification", "Business need");
    form.set("neededBy", "2026-08-10");
    form.set("personEmail", "person@example.test");
    form.set("personFullName", "Person Name");
    form.set("personCompanyId", "company-id");

    expect(requestInputFromForm(form, "self")).toEqual({
      requestFor: "self",
      vendorAccountId: "vendor-id",
      licenseTypeId: "license-id",
      justification: "Business need",
      neededBy: "2026-08-10",
    });
    expect(requestInputFromForm(form, "on_behalf")).toEqual({
      requestFor: "on_behalf",
      vendorAccountId: "vendor-id",
      licenseTypeId: "license-id",
      justification: "Business need",
      neededBy: "2026-08-10",
      personEmail: "person@example.test",
      personFullName: "Person Name",
      personCompanyId: "company-id",
    });
    form.delete("neededBy");
    expect(requestInputFromForm(form, "self")).not.toHaveProperty("neededBy");
    expect(requestInputFromForm(new FormData(), "self")).toEqual({
      requestFor: "self",
      vendorAccountId: "",
      licenseTypeId: "",
      justification: "",
    });
    expect(requestInputFromForm(new FormData(), "on_behalf")).toEqual({
      requestFor: "on_behalf",
      vendorAccountId: "",
      licenseTypeId: "",
      justification: "",
      personEmail: "",
      personFullName: "",
      personCompanyId: "",
    });
  });

  test("settles errors in place and successes at the created destination", () => {
    expect(submissionAllowed(false)).toBe(true);
    expect(submissionAllowed(true)).toBe(false);
    expect(
      submissionSettlement({ ok: false, error: "submission_failed" }),
    ).toEqual({ succeeded: false, destination: null });
    expect(
      submissionSettlement({
        ok: true,
        requestId: "request-id",
        redirectTo: "/solicitudes/request-id",
        warnings: [],
      }),
    ).toEqual({
      succeeded: true,
      destination: "/solicitudes/request-id?created=1",
    });
  });
});

"use client";

import { submitRequest } from "@/modules/request-workflow/actions/submit-request";
import type { RequestExecutor } from "./request-submission-controller";

export const executeRequestSubmission: RequestExecutor = (input) =>
  submitRequest(input);

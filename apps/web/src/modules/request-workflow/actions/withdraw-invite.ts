"use server";

import { revalidatePath } from "next/cache";
import type pg from "pg";
import { z } from "zod";
// eslint-disable-next-line no-restricted-imports -- Production withdrawal composes the shared database client and audited service.
import { db } from "@smp/db";
// eslint-disable-next-line no-restricted-imports -- Production action composes the shared withdrawal transaction service.
import {
  createAuthorizedInvitationWithdrawal,
  createInvitationWithdrawalService,
  createProductionInvitationWithdrawalConnector,
  type InvitationWithdrawalOutcome,
  type InvitationWithdrawalConnectorFactory,
  type InvitationWithdrawalLimiterFactory,
} from "@smp/db/invitation-withdrawal";
import { assertLegalTransition } from "@smp/domain/request-workflow";
import { parseCredentialEnvelope } from "@smp/domain";
import { loadCurrentLedgerAuthorization } from "../../identity-access/server-authorization";
import { AUTHORIZATION_SYSTEM_ENTITY_ID } from "../../identity-access/authorization";
import { withAudit } from "../../audit/with-audit";

const pool=(db as unknown as {$client:pg.Pool}).$client;
const now=()=>new Date();
const service=createInvitationWithdrawalService({pool,now,assertLegalTransition,
  connectorFor:async(context)=>{
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Literal import lets Next bundle the approved neutral worker composition without importing provider source into web tsc.
    const {createProvisioningConnector,createProvisioningRateLimiter}=require("../../../../../worker/src/connector-composition.ts") as {
      createProvisioningConnector:InvitationWithdrawalConnectorFactory;
      createProvisioningRateLimiter:InvitationWithdrawalLimiterFactory;
    };
    return createProductionInvitationWithdrawalConnector({pool,now,parseCredentialEnvelope,kekFile:process.env.LEDGER_CREDENTIAL_KEK_FILE??"",
      createConnector:createProvisioningConnector,createLimiter:createProvisioningRateLimiter,
    })(context);
  },
});
const command=z.object({requestId:z.string().uuid(),actionId:z.string().uuid(),commandId:z.string().uuid(),note:z.string().trim().min(1).max(2000)});

export async function withdrawInvite(form: FormData): Promise<InvitationWithdrawalOutcome> {
  return withAudit(db as unknown as Parameters<typeof withAudit>[0],async()=>{
    let actorUserId:string|null=null,requestId:string|null=null;
    const execute=createAuthorizedInvitationWithdrawal({pool,loadAuthorization:loadCurrentLedgerAuthorization,service,
      recordOutcome:async(actor,request)=>{actorUserId=actor;requestId=request;},
    });
    const parsed=command.safeParse(Object.fromEntries(form));
    if(!parsed.success) form.set("note","");
    const result=await execute(form);
    if(result.ok){revalidatePath("/excepciones");revalidatePath(`/solicitudes/${result.requestId}`);}
    return {value:result,audit:{actorUserId,action:"server_action.withdrawInvite",entityType:"LicenseRequest",entityId:requestId??AUTHORIZATION_SYSTEM_ENTITY_ID,companyId:null,note:null,before:null,after:result}};
  },{occurredAt:now()});
}

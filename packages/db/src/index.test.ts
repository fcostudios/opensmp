import { expect, test } from "vitest";
import { acceptMemberObservation, db, type MemberObservationInput } from "./index";
import { acceptMemberObservation as implementation } from "./member-observations";

test("US-083 public root binds the real acceptance service and rejects malformed account evidence",async()=>{
  expect(acceptMemberObservation).toBe(implementation);
  const input:MemberObservationInput={vendorAccountId:"invalid-account",source:"api",observedAt:new Date("2026-10-11T00:00:00Z"),
    members:[],evidence:{member_seat_evidence:"none",member_license_identity:"none"},actorUserAccountId:null,
    completeness:{kind:"api",pages:[],exhausted:[]}};
  expect(await acceptMemberObservation(db,input)).toEqual({status:"incomplete"});
});

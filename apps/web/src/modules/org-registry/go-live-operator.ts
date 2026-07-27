export {
  initializePrivateMaterial,
  type OperatorPaths,
} from "./go-live-operator-files";
export {
  GO_LIVE_OPERATOR_ACTOR_BOOTSTRAP_ACTION,
  GO_LIVE_OPERATOR_ACTOR_BOOTSTRAP_NOTE,
  runLockedGoLiveOperatorImport,
  type OperatorActor,
} from "./go-live-operator-transaction";
export {
  verifyGoLiveFixture,
  type FixtureVerificationInput,
} from "./go-live-fixture-verification";

export type OperatorMode = "init" | "preview" | "apply" | "verify";

export function parseOperatorMode(args: readonly string[]): OperatorMode {
  if (
    args.length === 1 &&
    (args[0] === "init" ||
      args[0] === "preview" ||
      args[0] === "apply" ||
      args[0] === "verify")
  ) {
    return args[0];
  }
  throw new Error(
    "Usage: pnpm --filter smp-web import:go-live <init|preview|apply|verify>",
  );
}

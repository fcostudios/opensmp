import messages from "@/lib/i18n/en-US.json";
import { ROUTE_AUTH_SIGNIN } from "@/lib/routes";

export function SignInButton() {
  return (
    <form action={ROUTE_AUTH_SIGNIN} method="get">
      <button
        type="submit"
        data-testid="btn_continue_corporativo"
        className="rounded-md bg-action-primary px-4 py-2 font-semibold text-action-primary-foreground"
      >
        {messages.auth.continueWithCorporativo}
      </button>
    </form>
  );
}

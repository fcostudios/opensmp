import { SignInButton } from "@/components/auth/sign-in-button";
import messages from "@/lib/i18n/en-US.json";

export default function LoginPage() {
  return (
    <main
      className="flex min-h-screen items-center justify-center bg-surface-canvas p-6"
      data-testid="screen_login"
    >
      <section className="w-full max-w-md rounded-lg bg-surface-panel p-8">
        <h1 className="text-2xl font-bold">{messages.auth.signInTitle}</h1>
        <p className="mb-6 mt-2 text-text-secondary">
          {messages.auth.credentialsAtCorporativo}
        </p>
        <SignInButton />
      </section>
    </main>
  );
}

import type { Metadata } from "next";

import { GustoConnectButton } from "@/components/GustoConnectButton";
import { PlaidLinkButton } from "@/components/PlaidLinkButton";
import { StripeConnectButton } from "@/components/StripeConnectButton";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/** Manual test page for the data connectors - not part of the founder-facing product yet. */
export default function ConnectPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-16">
      <div className="glass flex w-full max-w-sm flex-col items-center gap-5 rounded-3xl p-8 text-center">
        <h1 className="text-xl font-semibold text-foreground">Plaid sandbox test</h1>
        <p className="text-sm text-muted">Internal page for exercising the Plaid routes.</p>
        <PlaidLinkButton className="items-center" />
      </div>
      <div className="glass flex w-full max-w-sm flex-col items-center gap-5 rounded-3xl p-8 text-center">
        <h1 className="text-xl font-semibold text-foreground">Stripe sandbox test</h1>
        <p className="text-sm text-muted">
          Links the platform&apos;s Stripe sandbox account and syncs its balance transactions.
        </p>
        <StripeConnectButton />
      </div>
      <div className="glass flex w-full max-w-sm flex-col items-center gap-5 rounded-3xl p-8 text-center">
        <h1 className="text-xl font-semibold text-foreground">Gusto sandbox test</h1>
        <p className="text-sm text-muted">
          Connects to Gusto&apos;s auto-generated demo company via OAuth.
        </p>
        <GustoConnectButton />
      </div>
    </div>
  );
}

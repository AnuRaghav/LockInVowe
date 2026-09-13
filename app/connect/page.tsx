import type { Metadata } from "next";

import { PlaidLinkButton } from "@/components/PlaidLinkButton";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/** Manual test page for the Plaid connector - not part of the founder-facing product yet. */
export default function ConnectPage() {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="glass flex w-full max-w-sm flex-col items-center gap-5 rounded-3xl p-8 text-center">
        <h1 className="text-xl font-semibold text-foreground">Plaid sandbox test</h1>
        <p className="text-sm text-muted">Internal page for exercising the Plaid routes.</p>
        <PlaidLinkButton className="items-center" />
      </div>
    </div>
  );
}

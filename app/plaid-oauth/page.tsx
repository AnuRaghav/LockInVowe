import { PlaidLinkButton } from "@/components/PlaidLinkButton";

/**
 * OAuth return landing page. This exact URL - not "/connect", not
 * "/onboarding" - must be set as PLAID_REDIRECT_URI and registered in the
 * Plaid Dashboard's allowed redirect URIs, because Plaid checks the two
 * against each other exactly.
 *
 * Plaid calls this "a hosted blank webpage": all the real work happens in
 * PlaidLinkButton, which detects the `oauth_state_id` query param Plaid
 * appends on the way back and resumes the interrupted Link session rather
 * than starting a new one.
 */
export default function PlaidOAuthPage() {
  return (
    <div className="flex flex-col flex-1 items-center justify-center gap-4 p-16">
      <PlaidLinkButton />
    </div>
  );
}

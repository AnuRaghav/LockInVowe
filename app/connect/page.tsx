import { PlaidLinkButton } from "@/components/PlaidLinkButton";

/** Manual test page for the Plaid connector - not part of the founder-facing product yet. */
export default function ConnectPage() {
  return (
    <div className="flex flex-col flex-1 items-center justify-center gap-6 bg-zinc-50 p-16 dark:bg-black">
      <h1 className="text-xl font-semibold">Connect a bank account (sandbox)</h1>
      <PlaidLinkButton />
    </div>
  );
}

import { GustoConnectButton } from "@/components/GustoConnectButton";
import { PlaidLinkButton } from "@/components/PlaidLinkButton";

/** Manual test page for the data connectors - not part of the founder-facing product yet. */
export default function ConnectPage() {
  return (
    <div className="flex flex-col flex-1 items-center justify-center gap-10 bg-zinc-50 p-16 dark:bg-black">
      <div className="flex flex-col items-center gap-4">
        <h1 className="text-xl font-semibold">Connect a bank account (sandbox)</h1>
        <PlaidLinkButton />
      </div>
      <div className="flex flex-col items-center gap-4">
        <h1 className="text-xl font-semibold">Connect Gusto (sandbox)</h1>
        <GustoConnectButton />
      </div>
    </div>
  );
}

import Image from "next/image";

export function SamLogo() {
  return (
    <Image
      src="/brand/sam-logo-white-dot.png"
      alt="Sam"
      width={836}
      height={384}
      sizes="78px"
      loading="eager"
      className="h-9 w-auto shrink-0"
    />
  );
}

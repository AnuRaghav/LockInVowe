import { afterEach, describe, expect, it } from "vitest";

import { DEV_COMPANY_ID, resolveCompanyContext } from "@/lib/company/context";

const request = (headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/chat", { method: "POST", headers });

afterEach(() => {
  delete process.env.DEV_COMPANY_ID;
});

describe("resolveCompanyContext", () => {
  it("falls back to the built-in development company", () => {
    expect(resolveCompanyContext(request())).toEqual({
      companyId: DEV_COMPANY_ID,
    });
  });

  it("prefers DEV_COMPANY_ID when set", () => {
    process.env.DEV_COMPANY_ID = "company_env";

    expect(resolveCompanyContext(request())).toEqual({
      companyId: "company_env",
    });
  });

  it("honours the dev-only override header outside production", () => {
    expect(
      resolveCompanyContext(request({ "x-dev-company-id": "company_header" }))
    ).toEqual({ companyId: "company_header" });
  });
});

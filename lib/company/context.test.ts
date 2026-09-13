import { afterEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}));

const { resolveCompanyContext, resolveAuthenticatedCompanyContext, UnauthenticatedError } = await import("@/lib/company/context");

const request = (headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/chat", { method: "POST", headers });

afterEach(() => {
  vi.clearAllMocks();
});

describe("resolveCompanyContext", () => {
  it("throws when there is no signed-in founder", async () => {
    getUser.mockResolvedValue({ data: { user: null } });

    await expect(resolveCompanyContext(request())).rejects.toBeInstanceOf(
      UnauthenticatedError
    );
  });

  it("resolves company and founder to the authenticated user's id", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "user_123" } } });

    await expect(resolveCompanyContext(request())).resolves.toEqual({
      companyId: "user_123",
      founderId: "user_123",
    });
  });

  it("honours the dev-only override header outside production, without touching auth", async () => {
    await expect(
      resolveCompanyContext(request({ "x-dev-company-id": "company_header" }))
    ).resolves.toEqual({ companyId: "company_header", founderId: "company_header" });

    expect(getUser).not.toHaveBeenCalled();
  });

  it("always uses the authenticated user for company-scoped planning", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "authenticated-company" } } });

    await expect(resolveAuthenticatedCompanyContext()).resolves.toEqual({
      companyId: "authenticated-company",
      founderId: "authenticated-company",
    });
  });
});

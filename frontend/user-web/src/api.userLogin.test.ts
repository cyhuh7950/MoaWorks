// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";

import { login } from "./api";

afterEach(() => vi.unstubAllGlobals());

it("사용자 포털은 관리자 MFA 로그인과 구분된 주소로 비밀번호 로그인한다", async () => {
  const response = {
    nextAction: "authenticated",
    accessToken: "user-portal-token",
    tokenType: "bearer",
    expiresIn: 3600,
    user: {
      userId: "admin-user",
      companyId: "company",
      userName: "Admin",
      userEmail: "admin@moaworks.invalid",
      roleId: "role",
      roleName: "일반사용자",
      userType: "admin",
      status: "active",
      permissions: ["mail:read"],
      mustChangePassword: false,
    },
  };
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => response });
  vi.stubGlobal("fetch", fetchMock);

  expect(await login({ email: "admin@moaworks.invalid", password: "password" })).toEqual(response);
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/v1/auth/user/login",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ email: "admin@moaworks.invalid", password: "password" }),
    }),
  );
});

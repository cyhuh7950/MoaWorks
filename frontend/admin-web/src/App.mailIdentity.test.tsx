// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { DirectoryOverview } from "./api";

const api = vi.hoisted(() => ({
  fetchManagedMailDomains: vi.fn(), addManagedMailDomain: vi.fn(), setManagedMailDomainStatus: vi.fn(),
  fetchManagedMailAddresses: vi.fn(), addManagedMailAddress: vi.fn(), setManagedMailAddressStatus: vi.fn(),
}));
vi.mock("./api", async () => ({ ...await vi.importActual<typeof import("./api")>("./api"), ...api }));

import { MailIdentityPanel } from "./App";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("관리자가 도메인·수신 주소를 등록한 뒤 발신 준비를 별도로 요청한다", async () => {
  api.fetchManagedMailDomains.mockResolvedValue([{ domain: "sinsan.kr", status: "active", isPrimary: false }]);
  api.fetchManagedMailAddresses.mockResolvedValue([{ address: "alias@sinsan.kr", userId: "user-a", isPrimary: false, active: true, sendRequested: false, sendEnabled: false, domainStatus: "active" }]);
  api.addManagedMailDomain.mockResolvedValue({ domain: "sinsan.kr", status: "pending", isPrimary: false });
  api.addManagedMailAddress.mockResolvedValue({ address: "alias@sinsan.kr" });
  api.setManagedMailAddressStatus.mockResolvedValue({ address: "alias@sinsan.kr" });
  const users = [{ userId: "user-a", userName: "Tester", userEmail: "tester@moaworks.sinsan.kr", status: "active" }] as DirectoryOverview["users"];
  render(<MailIdentityPanel token="token" users={users} />);
  fireEvent.change(screen.getByPlaceholderText("sinsan.kr"), { target: { value: "sinsan.kr" } });
  fireEvent.click(screen.getByRole("button", { name: "도메인 등록" }));
  await waitFor(() => expect(api.addManagedMailDomain).toHaveBeenCalledWith("token", "sinsan.kr"));
  fireEvent.change(screen.getByLabelText("주소 소유 사용자"), { target: { value: "user-a" } });
  await screen.findByText("alias@sinsan.kr");
  fireEvent.change(screen.getByPlaceholderText("user@sinsan.kr"), { target: { value: "another@sinsan.kr" } });
  fireEvent.click(screen.getByRole("button", { name: "주소 연결" }));
  await waitFor(() => expect(api.addManagedMailAddress).toHaveBeenCalledWith("token", "user-a", "another@sinsan.kr"));
  fireEvent.click(screen.getByRole("button", { name: "발신 준비 요청" }));
  await waitFor(() => expect(api.setManagedMailAddressStatus).toHaveBeenCalledWith("token", "user-a", "alias@sinsan.kr", true, true, false));
});

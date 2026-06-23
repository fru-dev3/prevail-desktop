import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Mock the Tauri bridge + backup so the modal can be exercised headlessly.
const invokeMock = vi.fn();
vi.mock("./bridge", () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));
vi.mock("./backup", () => ({ backupVaultNow: vi.fn(async () => true) }));

import { VaultEncryptPrompt, vaultEncryptOffered } from "./vault-encrypt-prompt";

beforeEach(() => {
  invokeMock.mockReset();
  localStorage.clear();
});

describe("VaultEncryptPrompt — first-run encrypt-at-rest (default-ON)", () => {
  it("disables Encrypt until an 8-char matching passcode is entered", () => {
    render(<VaultEncryptPrompt vaultPath="/v" onClose={() => {}} />);
    const btn = screen.getByRole("button", { name: /encrypt vault/i });
    expect(btn).toBeDisabled(); // empty
    const [pass, confirm] = screen.getAllByPlaceholderText(/passcode/i);
    fireEvent.change(pass, { target: { value: "short" } }); // < 8
    fireEvent.change(confirm, { target: { value: "short" } });
    expect(btn).toBeDisabled();
    fireEvent.change(pass, { target: { value: "longenough" } });
    fireEvent.change(confirm, { target: { value: "different" } }); // mismatch
    expect(btn).toBeDisabled();
    fireEvent.change(confirm, { target: { value: "longenough" } }); // match, >=8
    expect(btn).toBeEnabled();
  });

  it("encrypts, shows the recovery code, and GATES dismissal until acknowledged", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "engine_vault_encrypt") return Promise.resolve({ ok: true, recoveryCode: "ABCDE-FGHJK-LMNPQ-RSTVW" });
      return Promise.resolve(undefined);
    });
    const onClose = vi.fn();
    render(<VaultEncryptPrompt vaultPath="/v" onClose={onClose} />);
    const [pass, confirm] = screen.getAllByPlaceholderText(/passcode/i);
    fireEvent.change(pass, { target: { value: "supersecret" } });
    fireEvent.change(confirm, { target: { value: "supersecret" } });
    fireEvent.click(screen.getByRole("button", { name: /encrypt vault/i }));

    // Recovery code is displayed.
    await waitFor(() => expect(screen.getByText("ABCDE-FGHJK-LMNPQ-RSTVW")).toBeInTheDocument());
    // engine_vault_encrypt was invoked with the passcode for this vault.
    expect(invokeMock).toHaveBeenCalledWith("engine_vault_encrypt", { vault: "/v", passcode: "supersecret" });
    // SAFETY NET: once the recovery code is shown there is NO skip/close path —
    // only "I saved it", and the parent is NOT auto-closed (no silent dismissal
    // that would lose the only lockout-recovery secret).
    expect(screen.queryByRole("button", { name: /not now/i })).toBeNull();
    expect(screen.getByRole("button", { name: /i saved it/i })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("'Not now' opts out, closes, and won't re-prompt", () => {
    const onClose = vi.fn();
    render(<VaultEncryptPrompt vaultPath="/v" onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /not now/i }));
    expect(onClose).toHaveBeenCalled();
    expect(vaultEncryptOffered()).toBe(true);
  });
});

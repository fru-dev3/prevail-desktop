import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// The shared Obsidian import modal is reachable from BOTH the Map header and the
// Apps panel. This locks its core flow: pick a folder, run the engine import,
// show the success summary - independent of which panel opened it.

const invokeMock = vi.fn(async (cmd: string) => {
  if (cmd === "engine_obsidian_import") return { ok: true, imported: 7 };
  return undefined;
});
vi.mock("./bridge", () => ({ invoke: (...a: unknown[]) => invokeMock(...(a as [string])) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(async () => "/Users/me/Notes") }));

import { ObsidianImportModal } from "./obsidianmodal";

beforeEach(() => { invokeMock.mockClear(); try { localStorage.clear(); } catch { /* ignore */ } });

describe("ObsidianImportModal", () => {
  it("picks a folder, imports, and reports the count", async () => {
    const onDone = vi.fn();
    render(
      <ObsidianImportModal
        vaultPath="/v"
        domains={[{ slug: "dev", label: "Dev" }]}
        onClose={() => {}}
        onDone={onDone}
      />,
    );
    expect(screen.getByText("Import an Obsidian vault")).toBeTruthy();
    fireEvent.click(screen.getByText("Choose folder..."));
    await waitFor(() => expect(screen.getByText("/Users/me/Notes")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "engine_obsidian_import",
        expect.objectContaining({ from: "/Users/me/Notes", vault: "/v", domain: "notes" }),
      ),
    );
    await waitFor(() => expect(screen.getByText(/Imported/)).toBeTruthy());
    expect(screen.getByText("7")).toBeTruthy();
  });

  it("Import is disabled until a folder is chosen", () => {
    render(
      <ObsidianImportModal vaultPath="/v" domains={[]} onClose={() => {}} onDone={() => {}} />,
    );
    expect(screen.getByRole("button", { name: "Import" })).toHaveProperty("disabled", true);
  });
});

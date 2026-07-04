// Clipboard-image paste for composers (Chat + Council). macOS puts clipboard
// images on the pasteboard as image/tiff more often than not, which no model
// can read and which the old path REJECTED - the reason pasting "did nothing".
// Every pasted image is therefore normalized to PNG via canvas (WebKit decodes
// TIFF natively), saved to <vault>/build/_meta/attachments through the Rust
// save_pasted_image command, and returned as a path the caller attaches to the
// turn (models read it with their multimodal file tools). Checks BOTH
// clipboardData.items and .files (WKWebView populates either, depending on the
// source app). Text-only pastes return empty and leave the event alone.

import { invoke } from "./bridge";

function b64of(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000; // String.fromCharCode(...) has an argument-count limit
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

const MODEL_READABLE = new Set(["png", "jpg", "jpeg", "gif", "webp"]);

// Encode a pasted image file as a model-readable payload: pass through formats
// models can read; transcode everything else (TIFF, BMP, HEIC where WebKit can
// decode it) to PNG. Returns null when the data can't be decoded as an image.
async function toReadableImage(file: File): Promise<{ b64: string; ext: string } | null> {
  const rawExt = (file.type.split("/")[1] || "").toLowerCase();
  if (MODEL_READABLE.has(rawExt)) {
    return { b64: b64of(new Uint8Array(await file.arrayBuffer())), ext: rawExt.replace("jpeg", "jpg") };
  }
  try {
    const bmp = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    canvas.getContext("2d")!.drawImage(bmp, 0, 0);
    const blob: Blob = await new Promise((res, rej) =>
      canvas.toBlob((b) => (b ? res(b) : rej(new Error("png encode failed"))), "image/png"),
    );
    return { b64: b64of(new Uint8Array(await blob.arrayBuffer())), ext: "png" };
  } catch {
    return null;
  }
}

export async function savePastedImages(
  e: React.ClipboardEvent,
  vaultPath: string,
): Promise<{ paths: string[]; errors: string[] }> {
  const dt = e.clipboardData;
  if (!dt || !vaultPath) return { paths: [], errors: [] };
  const files: File[] = [];
  for (const it of Array.from(dt.items ?? [])) {
    if (it.type.startsWith("image/")) {
      const f = it.getAsFile();
      if (f) files.push(f);
    }
  }
  if (files.length === 0) {
    for (const f of Array.from(dt.files ?? [])) {
      if (f.type.startsWith("image/")) files.push(f);
    }
  }
  if (files.length === 0) return { paths: [], errors: [] };
  e.preventDefault(); // it IS an image paste - keep binary junk out of the textarea
  const paths: string[] = [];
  const errors: string[] = [];
  for (const file of files) {
    try {
      const img = await toReadableImage(file);
      if (!img) {
        errors.push(`could not decode a pasted ${file.type || "image"}`);
        continue;
      }
      const p = await invoke<string>("save_pasted_image", {
        vault: vaultPath,
        dataBase64: img.b64,
        ext: img.ext,
      });
      paths.push(p);
    } catch (err) {
      errors.push(String(err).slice(0, 160));
    }
  }
  return { paths, errors };
}

import { validationError } from "../http/errors.js";

/** Allow-list of declared types. Each is verified against file content, not just the client-supplied header. */
export const allowedAttachmentTypes = ["application/pdf", "image/png", "image/jpeg", "image/webp", "text/plain"] as const;
export type AttachmentType = (typeof allowedAttachmentTypes)[number];

const startsWith = (data: Buffer, bytes: number[], offset = 0) => bytes.every((byte, i) => data[offset + i] === byte);

const signatureCheck: Record<AttachmentType, (data: Buffer) => boolean> = {
  "application/pdf": (d) => startsWith(d, [0x25, 0x50, 0x44, 0x46, 0x2d]),
  "image/png": (d) => startsWith(d, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  "image/jpeg": (d) => startsWith(d, [0xff, 0xd8, 0xff]),
  "image/webp": (d) => startsWith(d, [0x52, 0x49, 0x46, 0x46]) && startsWith(d, [0x57, 0x45, 0x42, 0x50], 8),
  "text/plain": (d) => {
    if (d.includes(0)) return false;
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(d);
      return true;
    } catch {
      return false;
    }
  }
};

export function normaliseContentType(header: string | undefined): AttachmentType | null {
  const base = (header ?? "").split(";")[0]?.trim().toLowerCase();
  return (allowedAttachmentTypes as readonly string[]).includes(base ?? "") ? (base as AttachmentType) : null;
}

/**
 * Reduces a client filename to a safe display label: no directories, no control or path/shell-significant characters,
 * bounded length. The result is metadata only; storage paths never derive from it.
 */
export function sanitiseFileName(raw: unknown): string {
  if (typeof raw !== "string") throw validationError("A filename query parameter is required");
  const base = raw.normalize("NFC").split(/[\\/]/).pop() ?? "";
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f<>:"|?*\u202a-\u202e\u2066-\u2069]/g, "").replace(/^\.+/, "").trim().slice(0, 120);
  if (cleaned.length === 0) throw validationError("Filename is not valid");
  return cleaned;
}

export interface ValidatedUpload { fileName: string; contentType: AttachmentType; data: Buffer }

export function validateUpload(input: { body: unknown; contentTypeHeader: string | undefined; filename: unknown; maxBytes: number }): ValidatedUpload {
  const contentType = normaliseContentType(input.contentTypeHeader);
  if (!contentType) throw validationError("Unsupported file type", { allowed: allowedAttachmentTypes });
  const fileName = sanitiseFileName(input.filename);
  if (!Buffer.isBuffer(input.body) || input.body.length === 0) throw validationError("File content is required");
  if (input.body.length > input.maxBytes) throw validationError("File is too large", { maxBytes: input.maxBytes });
  if (!signatureCheck[contentType](input.body)) throw validationError("File content does not match its declared type");
  return { fileName, contentType, data: input.body };
}

/** RFC 6266/5987 header value: ASCII fallback plus UTF-8 encoded name. Always `attachment`, never inline. */
export function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\;]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;
}

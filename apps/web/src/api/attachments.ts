export const ALLOWED_ATTACHMENT_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/plain",
] as const;

export type AllowedAttachmentType = (typeof ALLOWED_ATTACHMENT_TYPES)[number];

export const ALLOWED_ATTACHMENT_EXTENSIONS = [
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".txt",
] as const;

export const MAX_ATTACHMENT_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

const EXTENSION_MIME_MAP: Record<string, AllowedAttachmentType> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".txt": "text/plain",
};

/**
 * Normalises and resolves the effective MIME type of an attachment file.
 * Handles browsers that leave file.type empty or default to application/octet-stream.
 */
export function getAttachmentContentType(file: File): string {
  const declared = (file.type || "").split(";")[0]?.trim().toLowerCase();
  if (declared && (ALLOWED_ATTACHMENT_TYPES as readonly string[]).includes(declared)) {
    return declared;
  }
  const dotIndex = file.name.lastIndexOf(".");
  if (dotIndex !== -1) {
    const ext = file.name.slice(dotIndex).toLowerCase();
    const mapped = EXTENSION_MIME_MAP[ext];
    if (mapped) {
      return mapped;
    }
  }

  return declared || "application/octet-stream";
}

/**
 * Validates file type and size constraints prior to upload.
 */
export function validateAttachmentFile(file: File | null | undefined): { valid: boolean; error?: string } {
  if (!file) {
    return { valid: false, error: "Please select a file to attach." };
  }

  if (file.size === 0) {
    return { valid: false, error: "Attachment file cannot be empty (0 bytes)." };
  }

  if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
    const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
    return {
      valid: false,
      error: `File size (${sizeMb} MB) exceeds the 5 MB limit. Please select a smaller file.`,
    };
  }

  const resolvedType = getAttachmentContentType(file);
  if (!(ALLOWED_ATTACHMENT_TYPES as readonly string[]).includes(resolvedType)) {
    return {
      valid: false,
      error: `Unsupported file type (${file.type || "unknown"}). Allowed types: PDF, PNG, JPEG, WebP, and Plain Text.`,
    };
  }

  return { valid: true };
}

/**
 * Sanitises a raw filename to prevent directory traversal, control characters,
 * and dangerous execution names.
 */
export function sanitizeFileName(raw: string): string {
  const base = raw.normalize("NFC").split(/[/\\]/).pop() ?? "";
  // Strip control characters, path-traversal tokens, and Windows forbidden characters
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f<>:"|?*\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 120);

  return cleaned.length > 0 ? cleaned : "attachment";
}

/**
 * Extracts a safe filename from a server Content-Disposition header (RFC 6266 / RFC 5987),
 * falling back to the supplied default if absent or invalid.
 */
export function extractSafeFileName(
  contentDispositionHeader: string | null | undefined,
  fallback: string
): string {
  if (contentDispositionHeader) {
    // 1. Try RFC 5987 UTF-8 encoding: filename*=UTF-8''...
    const utf8Match = contentDispositionHeader.match(/filename\*\s*=\s*UTF-8''([^;\r\n]+)/i);
    if (utf8Match && utf8Match[1]) {
      try {
        const decoded = decodeURIComponent(utf8Match[1].trim());
        const sanitized = sanitizeFileName(decoded);
        if (sanitized && sanitized !== "attachment") return sanitized;
      } catch {
        // Fall through to standard filename
      }
    }

    // 2. Try quoted filename="...":
    const quotedMatch = contentDispositionHeader.match(/filename\s*=\s*"([^"]+)"/i);
    if (quotedMatch && quotedMatch[1]) {
      const sanitized = sanitizeFileName(quotedMatch[1].trim());
      if (sanitized && sanitized !== "attachment") return sanitized;
    }

    // 3. Try unquoted filename=...:
    const unquotedMatch = contentDispositionHeader.match(/filename\s*=\s*([^;\s]+)/i);
    if (unquotedMatch && unquotedMatch[1]) {
      const sanitized = sanitizeFileName(unquotedMatch[1].trim());
      if (sanitized && sanitized !== "attachment") return sanitized;
    }
  }

  return sanitizeFileName(fallback);
}

/**
 * Human-readable byte formatting (e.g. "320 KB", "1.4 MB").
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

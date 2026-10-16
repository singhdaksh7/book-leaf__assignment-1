import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";

/** Storage boundary. Swap the implementation (e.g. object storage) without touching routes. Keys are opaque and server-generated. */
export interface AttachmentStorage {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
}

export const newStorageKey = (): string => randomBytes(24).toString("hex");
const keyPattern = /^[a-f0-9]{48}$/;

/** Local-disk store. Rejects any key that is not a 48-char hex string and re-checks containment after path resolution. */
export class LocalDiskStorage implements AttachmentStorage {
  private readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }

  private pathFor(key: string): string {
    if (!keyPattern.test(key)) throw new Error("Invalid storage key");
    const path = resolve(this.root, key);
    if (!path.startsWith(this.root + sep)) throw new Error("Invalid storage key");
    return path;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(this.root, { recursive: true });
    // 'wx': never overwrite an existing object.
    await writeFile(path, data, { flag: "wx", mode: 0o600 });
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.pathFor(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }
}

import argon2 from "argon2";

/** OWASP-recommended Argon2id minimum (19 MiB, 2 passes, 1 lane). Verification reads parameters from the stored hash. */
export const defaultArgon2Options = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export type Argon2Options = { memoryCost?: number; timeCost?: number; parallelism?: number };

export function hashPassword(password: string, options: Argon2Options = {}): Promise<string> {
  return argon2.hash(password, { ...defaultArgon2Options, ...options });
}

/** Never throws for malformed hashes; a failed verification is simply `false`. */
export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

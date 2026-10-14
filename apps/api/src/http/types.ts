import type { UserRole } from "@bookleaf/db";

export interface AuthContext {
  sessionId: string;
  expiresAt: Date;
  user: { id: string; email: string; role: UserRole };
  authorProfile: { id: string; userId: string; externalAuthorId: string; name: string; phone: string; city: string; joinedDate: Date } | null;
}

declare module "express-serve-static-core" {
  interface Request {
    requestId: string;
    auth?: AuthContext;
  }
}

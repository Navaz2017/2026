import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import type { Role } from "@prisma/client";
import { config } from "../config.js";

export interface AuthUser {
  sub: string;
  role: Role;
  inst?: string; // institution id for INSTITUTION_ADMIN
  mfa?: boolean; // this session passed a TOTP check
}

declare module "express-serve-static-core" {
  interface Request {
    user?: AuthUser;
  }
}

export function authenticate(req: Request, res: Response, next: NextFunction) {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) return res.status(401).json({ error: "unauthenticated" });
  try {
    req.user = jwt.verify(h.slice(7), config.JWT_ACCESS_SECRET, { algorithms: ["HS256"], issuer: "admissions" }) as AuthUser;
    next();
  } catch {
    res.status(401).json({ error: "invalid_token" });
  }
}

// One frontend, many "inboxes": the role in the token decides which routes (and which data) are reachable.
export const requireRole =
  (...roles: Role[]) =>
  (req: Request, res: Response, next: NextFunction) =>
    req.user && roles.includes(req.user.role) ? next() : res.status(403).json({ error: "forbidden" });

export const signAccess = (u: AuthUser) =>
  jwt.sign(u, config.JWT_ACCESS_SECRET, { algorithm: "HS256", expiresIn: "15m", issuer: "admissions" });

// SYSTEM_OWNER may do nothing privileged without MFA; institution admins need it for children's documents and decisions.
export const requireMfa = (req: Request, res: Response, next: NextFunction) =>
  req.user?.mfa ? next() : res.status(403).json({ error: "mfa_required" });

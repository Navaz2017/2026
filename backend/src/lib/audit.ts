import type { Request } from "express";
import { prisma } from "../db.js";

export const audit = (req: Request, action: string, entity: string, entityId?: string, meta?: object) =>
  prisma.auditLog.create({
    data: { actorId: req.user?.sub, action, entity, entityId, meta: meta as object | undefined, ip: req.ip },
  });

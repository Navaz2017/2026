import type { NextFunction, Request, Response } from "express";
import type { ZodTypeAny, z } from "zod";

export const body =
  <T extends ZodTypeAny>(schema: T) =>
  (req: Request, res: Response, next: NextFunction) => {
    const r = schema.safeParse(req.body);
    if (!r.success) return res.status(400).json({ error: "validation", issues: r.error.issues });
    req.body = r.data as z.infer<T>;
    next();
  };

// Express 4 does not catch async rejections.
export const h =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res, next).catch(next);

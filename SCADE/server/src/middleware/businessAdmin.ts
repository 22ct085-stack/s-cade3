import { timingSafeEqual } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';

export function requireBusinessAdmin(req: Request, res: Response, next: NextFunction) {
  const expected = env.businessAdminToken;
  const supplied = req.header('x-admin-token') ?? '';
  if (!expected) return res.status(503).json({ success: false, error: 'Business admin is not configured. Set BUSINESS_ADMIN_TOKEN on the server.' });
  const expectedBytes = Buffer.from(expected); const suppliedBytes = Buffer.from(supplied);
  const valid = expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
  if (!valid) return res.status(401).json({ success: false, error: 'Admin token is invalid.' });
  next();
}

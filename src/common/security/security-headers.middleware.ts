import type { NextFunction, Request, Response } from 'express';

/**
 * Cabeçalhos de segurança da API. É uma API JSON: nada dela deve ser
 * renderizado, emoldurado ou guardado em cache. Os arquivos públicos
 * (`/files`) têm a sua própria política (ver `main.ts`).
 */
export function securityHeaders(production: boolean) {
  return (_request: Request, response: Response, next: NextFunction): void => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-DNS-Prefetch-Control', 'off');
    if (production) response.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  };
}

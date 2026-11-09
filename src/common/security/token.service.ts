import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';

/**
 * Cada tipo de token tem a sua audiência: um token de telemetria ou de vídeo
 * nunca passa como token de acesso, e vice-versa. O algoritmo é fixado em
 * HS256 na assinatura e na verificação (nada de `alg: none` nem troca de algoritmo).
 */
export const TokenKind = {
  access: 'orbitplay-api',
  telemetry: 'orbitplay-telemetry',
  video: 'orbitplay-video',
} as const;
export type TokenKindName = keyof typeof TokenKind;

export const TOKEN_ISSUER = 'orbitplay';

@Injectable()
export class TokenService {
  constructor(private readonly jwt: JwtService) {}

  sign(kind: TokenKindName, payload: Record<string, unknown>, expiresInSeconds: number): Promise<string> {
    return this.jwt.signAsync(payload, {
      expiresIn: expiresInSeconds,
      audience: TokenKind[kind],
      issuer: TOKEN_ISSUER,
      algorithm: 'HS256',
      jwtid: randomUUID(),
    });
  }

  verify<T extends object>(kind: TokenKindName, token: string): Promise<T & { jti?: string; iat?: number; exp?: number }> {
    return this.jwt.verifyAsync(token, {
      audience: TokenKind[kind],
      issuer: TOKEN_ISSUER,
      algorithms: ['HS256'],
    });
  }
}

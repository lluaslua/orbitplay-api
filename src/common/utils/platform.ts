import type { Platform } from '../../contracts';

/** Cabeçalho que o app do tester manda com o sistema em que roda. */
export const CLIENT_PLATFORM_HEADER = 'x-client-platform';

/** `process.platform` do Electron e os códigos do contrato viram o mesmo `Platform`. */
const APELIDOS: Record<string, Platform> = {
  pc: 'PC',
  win32: 'PC',
  windows: 'PC',
  mac: 'MAC',
  darwin: 'MAC',
  macos: 'MAC',
  linux: 'LINUX',
  android: 'ANDROID',
  ios: 'IOS',
  web: 'WEB',
  console: 'CONSOLE',
};

/** Sem cabeçalho (ou com valor desconhecido) não se sabe o sistema — e nada é barrado. */
export function clientPlatform(header: string | string[] | undefined): Platform | null {
  const valor = (Array.isArray(header) ? header[0] : header)?.trim().toLowerCase();
  return valor ? (APELIDOS[valor] ?? null) : null;
}

/**
 * A build roda no sistema do app? Teste sem build (A/B de imagens) ou build
 * sem plataformas conhecidas roda em qualquer um.
 */
export function runsOn(buildPlatforms: string[] | null | undefined, platform: Platform | null): boolean {
  if (!platform || !buildPlatforms?.length) return true;
  return buildPlatforms.includes(platform);
}

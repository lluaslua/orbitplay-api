import { BadRequestException } from '@nestjs/common';
import { open } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { ErrorCode } from '../constants/error-codes';

/** Tipos aceitos e a extensão com que cada um é gravado. A extensão vem daqui, nunca do nome enviado. */
export const IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

export const VIDEO_TYPES: Record<string, string> = {
  'video/webm': '.webm',
  'video/mp4': '.mp4',
};

/** Extensões de build aceitas (`.unity`/`.unreal` são os projetos de engine que `platformsOf` já conhece). */
export const BUILD_EXTENSIONS = ['.zip', '.exe', '.apk', '.dmg', '.unity', '.unreal'] as const;

export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const VIDEO_MAX_BYTES = 500 * 1024 * 1024;

type Callback = (error: Error | null, aceitar: boolean) => void;
type Arquivo = Pick<Express.Multer.File, 'mimetype' | 'originalname'>;

function recusar(callback: Callback, message: string) {
  callback(new BadRequestException({ message, code: ErrorCode.INVALID_FILE_TYPE }), false);
}

/** `multer` entrega o nome em latin1; isto devolve o UTF-8 e tira qualquer caminho. */
export function originalName(file: Pick<Express.Multer.File, 'originalname'>): string {
  const nome = Buffer.from(file.originalname, 'latin1').toString('utf8');
  return basename(nome.replace(/\\/g, '/')).replace(/^\.+/, '') || 'arquivo';
}

export function imageFilter(_req: unknown, file: Arquivo, callback: Callback): void {
  if (file.mimetype in IMAGE_TYPES) callback(null, true);
  else recusar(callback, 'Envie uma imagem JPG, PNG ou WebP.');
}

export function videoFilter(_req: unknown, file: Arquivo, callback: Callback): void {
  if (file.mimetype in VIDEO_TYPES) callback(null, true);
  else recusar(callback, 'Envie a gravação em WebM ou MP4.');
}

export function buildFilter(_req: unknown, file: Arquivo, callback: Callback): void {
  const extensao = extname(originalName(file)).toLowerCase();
  if ((BUILD_EXTENSIONS as readonly string[]).includes(extensao)) callback(null, true);
  else recusar(callback, `Envie a build em ${BUILD_EXTENSIONS.join(', ')}.`);
}

/**
 * Conferência do conteúdo pelos primeiros bytes. O `Content-Type` e o nome
 * vêm do cliente e mentem à vontade; a assinatura do arquivo, não.
 * Extensão sem assinatura conhecida (`.dmg`, `.unity`, `.unreal`) não é barrada aqui.
 */
export async function matchesSignature(path: string, extensao: string): Promise<boolean> {
  const alvo = extensao.toLowerCase();
  const handle = await open(path, 'r');
  try {
    const cabeca = Buffer.alloc(16);
    const { bytesRead } = await handle.read(cabeca, 0, 16, 0);
    return assinaturaConfere(cabeca.subarray(0, bytesRead), alvo);
  } finally {
    await handle.close();
  }
}

export function assinaturaConfere(cabeca: Buffer, extensao: string): boolean {
  const comeca = (bytes: number[], deslocamento = 0) =>
    cabeca.length >= deslocamento + bytes.length && bytes.every((b, i) => cabeca[deslocamento + i] === b);

  switch (extensao) {
    case '.png':
      return comeca([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case '.jpg':
    case '.jpeg':
      return comeca([0xff, 0xd8, 0xff]);
    case '.webp':
      return comeca([0x52, 0x49, 0x46, 0x46]) && comeca([0x57, 0x45, 0x42, 0x50], 8);
    case '.webm':
      return comeca([0x1a, 0x45, 0xdf, 0xa3]);
    case '.mp4':
      return comeca([0x66, 0x74, 0x79, 0x70], 4);
    case '.zip':
    case '.apk':
      return comeca([0x50, 0x4b]);
    case '.exe':
      return comeca([0x4d, 0x5a]);
    default:
      return true;
  }
}

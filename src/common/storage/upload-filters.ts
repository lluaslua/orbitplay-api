import { BadRequestException } from '@nestjs/common';
import { basename, extname } from 'node:path';
import type { Request } from 'express';

/** Extensão que o nome do arquivo ganha a partir do mimetype, já com o ponto. */
export const IMAGE_TYPES: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

export const VIDEO_TYPES: Record<string, string> = {
  'video/webm': '.webm',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
};

/** O comentário do bootstrap limita cada imagem a 5 MB. */
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/** Gravação da sessão. O limite da build vem do .env; o vídeo fica à parte. */
export const VIDEO_MAX_BYTES = 500 * 1024 * 1024;

const EXTENSOES_DE_BUILD = new Set(['.zip', '.exe', '.dmg', '.apk', '.7z', '.unity', '.unreal']);

type FileFilter = (req: Request, file: Express.Multer.File, cb: (error: Error | null, accept: boolean) => void) => void;

function aceitar(permitido: boolean, mensagem: string): FileFilter {
  return (_req, _file, cb) => {
    if (permitido) cb(null, true);
    else cb(new BadRequestException({ message: mensagem }), false);
  };
}

export const imageFilter: FileFilter = (req, file, cb) =>
  aceitar(file.mimetype in IMAGE_TYPES, 'Envie uma imagem PNG, JPG, WEBP ou GIF.')(req, file, cb);

export const videoFilter: FileFilter = (req, file, cb) =>
  aceitar(file.mimetype in VIDEO_TYPES, 'Envie a gravação em WEBM, MP4 ou MOV.')(req, file, cb);

export const buildFilter: FileFilter = (req, file, cb) =>
  aceitar(
    EXTENSOES_DE_BUILD.has(extname(originalName(file)).toLowerCase()),
    'Envie a build em .zip, .exe, .dmg ou .apk.',
  )(req, file, cb);

/**
 * Nome original do arquivo. O multer entrega o nome em latin1; sem essa
 * conversão, acento vira lixo antes de ir para o banco.
 */
export function originalName(file: Express.Multer.File): string {
  const nome = Buffer.from(file.originalname, 'latin1').toString('utf8');
  return basename(nome);
}

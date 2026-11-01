import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { copyFile, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { IMAGE_MAX_BYTES, IMAGE_TYPES, VIDEO_TYPES } from './upload-filters';

type Visibilidade = 'public' | 'private';

/**
 * Arquivos no disco local (`STORAGE_DIR`). O que é público (capa, avatar,
 * resposta de "Envio de arquivo") sai em `/api/files/`. Build e gravação ficam
 * fora dessa pasta e só saem pelas rotas autenticadas.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  readonly root: string;
  readonly publicDir: string;
  readonly tmpDir: string;
  private readonly privateDir: string;
  private readonly publicApiUrl: string;

  constructor(config: ConfigService) {
    this.root = resolve(config.getOrThrow<string>('storage.dir'));
    this.publicDir = join(this.root, 'public');
    this.privateDir = join(this.root, 'private');
    this.tmpDir = join(this.root, 'tmp');
    this.publicApiUrl = config.getOrThrow<string>('app.publicApiUrl').replace(/\/$/, '');
  }

  async onModuleInit(): Promise<void> {
    await Promise.all([this.publicDir, this.privateDir, this.tmpDir].map((pasta) => mkdir(pasta, { recursive: true })));
  }

  /** Move o arquivo que o multer deixou na pasta temporária. */
  async store(from: string, key: string, visibility: Visibilidade): Promise<void> {
    const destino = this.pathOf(key, visibility);
    await mkdir(dirname(destino), { recursive: true });
    try {
      await rename(from, destino);
    } catch {
      await copyFile(from, destino);
      await rm(from, { force: true });
    }
  }

  /**
   * Data URL do rascunho (Novo jogo, "Envio de arquivo"). Devolve a chave já
   * com a extensão. Cada imagem continua limitada a 5 MB.
   */
  async storeDataUrl(dataUrl: string, keyBase: string, visibility: Visibilidade): Promise<string> {
    const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl);
    if (!match) throw new BadRequestException({ message: 'O arquivo enviado não é um data URL válido.' });

    const mime = match[1] ?? 'application/octet-stream';
    const buffer = match[2] ? Buffer.from(match[3], 'base64') : Buffer.from(decodeURIComponent(match[3]));
    if (buffer.length > IMAGE_MAX_BYTES) {
      throw new BadRequestException({ message: 'O arquivo passa do tamanho máximo permitido.', code: 'FILE_TOO_LARGE' });
    }

    const extensao = IMAGE_TYPES[mime] ?? VIDEO_TYPES[mime] ?? '';
    const key = `${keyBase}${extensao}`;
    const destino = this.pathOf(key, visibility);
    await mkdir(dirname(destino), { recursive: true });
    await writeFile(destino, buffer);
    return key;
  }

  async remove(key: string, visibility: Visibilidade): Promise<void> {
    await rm(this.pathOf(key, visibility), { force: true });
  }

  pathOf(key: string, visibility: Visibilidade): string {
    const base = resolve(visibility === 'public' ? this.publicDir : this.privateDir);
    const destino = resolve(base, key);
    if (destino !== base && !destino.startsWith(base + '\\') && !destino.startsWith(base + '/')) {
      throw new BadRequestException({ message: 'Caminho de arquivo inválido.' });
    }
    return destino;
  }

  /** URL absoluta servida por `useStaticAssets` em `/${prefix}/files/`. */
  publicUrl(key: string): string {
    return `${this.publicApiUrl}/files/${key}`;
  }
}

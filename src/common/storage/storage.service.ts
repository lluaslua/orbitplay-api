import { BadRequestException, Injectable, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { copyFile, mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { ErrorCode } from '../constants/error-codes';
import { assinaturaConfere, IMAGE_MAX_BYTES, IMAGE_TYPES, matchesSignature } from './upload-filters';

export type StorageScope = 'public' | 'private';

/** Temporários com mais que isto, de um envio que não terminou, são apagados no boot. */
const TMP_MAX_AGE_MS = 6 * 3600_000;

/**
 * Disco local em `STORAGE_DIR`: `public/` (capas, avatares) é servido pela API;
 * `private/` (builds e gravações) só sai por rota autorizada; `tmp/` é onde o
 * multer grava antes de a regra de negócio aceitar o arquivo.
 *
 * Toda chave é resolvida e conferida contra a raiz do escopo: `..` ou caminho
 * absoluto numa chave nunca sai da pasta. Para S3/Azure Blob, troca-se esta classe.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly root: string;
  private readonly publicApiUrl: string;

  constructor(config: ConfigService) {
    this.root = resolve(process.cwd(), config.getOrThrow<string>('storage.dir'));
    this.publicApiUrl = config.getOrThrow<string>('app.publicApiUrl');
  }

  get publicDir(): string {
    return join(this.root, 'public');
  }

  get privateDir(): string {
    return join(this.root, 'private');
  }

  get tmpDir(): string {
    return join(this.root, 'tmp');
  }

  async onModuleInit(): Promise<void> {
    await Promise.all([this.publicDir, this.privateDir, this.tmpDir].map((pasta) => mkdir(pasta, { recursive: true })));
    // Upload interrompido deixa o temporário para trás.
    const agora = Date.now();
    for (const nome of await readdir(this.tmpDir).catch(() => [] as string[])) {
      const caminho = join(this.tmpDir, nome);
      const info = await stat(caminho).catch(() => null);
      if (info && agora - info.mtimeMs > TMP_MAX_AGE_MS) await rm(caminho, { force: true });
    }
  }

  /** Caminho absoluto da chave, sempre dentro do escopo. */
  pathOf(key: string, scope: StorageScope): string {
    const base = scope === 'public' ? this.publicDir : this.privateDir;
    const caminho = resolve(base, key);
    if (!caminho.startsWith(base + sep)) {
      throw new BadRequestException({ message: 'Caminho de arquivo inválido.', code: ErrorCode.INVALID_FILE_TYPE });
    }
    return caminho;
  }

  publicUrl(key: string): string {
    return `${this.publicApiUrl}/files/${key.split('/').map(encodeURIComponent).join('/')}`;
  }

  /**
   * Move o temporário do multer para a chave. O conteúdo tem de bater com a
   * extensão da chave (`matchesSignature`); se não bater, o arquivo não entra.
   */
  async store(tmpPath: string, key: string, scope: StorageScope): Promise<void> {
    const destino = this.pathOf(key, scope);
    if (!(await matchesSignature(tmpPath, extname(key)))) {
      throw new BadRequestException({
        message: 'O conteúdo do arquivo não corresponde ao formato informado.',
        code: ErrorCode.INVALID_FILE_TYPE,
      });
    }
    await mkdir(dirname(destino), { recursive: true });
    try {
      await rename(tmpPath, destino);
    } catch {
      // Outro volume: rename não atravessa.
      await copyFile(tmpPath, destino);
      await rm(tmpPath, { force: true });
    }
  }

  /**
   * Imagem em data URL (como o app guarda o rascunho). Só PNG, JPEG e WebP,
   * até 5 MB, e a assinatura tem de bater com o tipo declarado. Devolve a chave
   * com a extensão — o nome do arquivo ganha um sufixo aleatório.
   */
  async storeDataUrl(dataUrl: string, keyBase: string, scope: StorageScope): Promise<string> {
    const partes = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\r\n]+)$/i.exec(dataUrl);
    const extensao = partes ? IMAGE_TYPES[partes[1].toLowerCase()] : undefined;
    if (!partes || !extensao) {
      throw new BadRequestException({ message: 'Envie uma imagem JPG, PNG ou WebP.', code: ErrorCode.INVALID_FILE_TYPE });
    }
    // O tamanho decodificado sai da conta, antes de alocar o buffer.
    if (Math.floor((partes[2].length * 3) / 4) > IMAGE_MAX_BYTES + 3) throw tooLarge();
    const bytes = Buffer.from(partes[2], 'base64');
    if (bytes.length > IMAGE_MAX_BYTES) throw tooLarge();
    if (!assinaturaConfere(bytes, extensao)) {
      throw new BadRequestException({
        message: 'O conteúdo da imagem não corresponde ao formato informado.',
        code: ErrorCode.INVALID_FILE_TYPE,
      });
    }

    const key = `${keyBase}-${randomBytes(8).toString('hex')}${extensao}`;
    const destino = this.pathOf(key, scope);
    await mkdir(dirname(destino), { recursive: true });
    await writeFile(destino, bytes);
    return key;
  }

  async remove(key: string, scope: StorageScope): Promise<void> {
    await rm(this.pathOf(key, scope), { force: true });
  }
}

function tooLarge() {
  return new BadRequestException({ message: 'A imagem passa de 5 MB.', code: 'FILE_TOO_LARGE' });
}

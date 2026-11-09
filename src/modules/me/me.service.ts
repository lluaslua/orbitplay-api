import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { rm } from 'node:fs/promises';
import { ErrorCode } from '../../common/constants/error-codes';
import type { RequestUser } from '../../common/interfaces/jwt-payload.interface';
import { StorageService } from '../../common/storage/storage.service';
import { IMAGE_TYPES } from '../../common/storage/upload-filters';
import type { AuthSession, AuthUser } from '../../contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { hashPassword, verifyPassword } from '../users/password';
import { UsersService } from '../users/users.service';
import type { ChangePasswordDto, UpdateMeDto } from './me.dto';

/** A própria conta ("Minha conta"), para qualquer perfil: dados, preferências, foto e senha. */
@Injectable()
export class MeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly auth: AuthService,
    private readonly storage: StorageService,
  ) {}

  /**
   * "Minha conta". Nascimento e país vão para o `PlayerProfile` no jogador (é
   * a elegibilidade dos testes) e para a própria conta no estúdio. Nome e site
   * do estúdio são da organização: só quem tem MANAGE muda.
   */
  async update(user: RequestUser, dto: UpdateMeDto): Promise<AuthUser> {
    const estudio = user.role === 'STUDIO' && user.studioId !== null;
    const mexeNoEstudio = dto.organization !== undefined || dto.website !== undefined;
    if (mexeNoEstudio && !(estudio && user.studioPermission === 'MANAGE')) {
      throw new ForbiddenException({
        message: 'Só quem gerencia o estúdio muda o nome e o site do estúdio.',
        code: ErrorCode.TEAM_PERMISSION,
      });
    }

    const birthDate = dto.birthDate ? new Date(dto.birthDate) : undefined;
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          name: dto.name?.trim(),
          locale: dto.locale,
          emailNotifications: dto.emailNotifications,
          mfaEnabled: dto.mfaEnabled,
          ...(estudio ? { jobTitle: dto.jobTitle?.trim(), birthDate, location: dto.location } : {}),
        },
      });
      if (user.role === 'PLAYER' && (birthDate || dto.location)) {
        await tx.playerProfile.update({ where: { userId: user.id }, data: { birthDate, location: dto.location } });
      }
      if (estudio && mexeNoEstudio) {
        await tx.studio.update({
          where: { id: user.studioId! },
          data: { name: dto.organization?.trim(), website: dto.website === '' ? null : dto.website },
        });
      }
    });
    return this.current(user.id);
  }

  async uploadAvatar(user: RequestUser, file: Express.Multer.File): Promise<AuthUser> {
    try {
      const key = `avatars/${user.id}-${Date.now()}${IMAGE_TYPES[file.mimetype]}`;
      await this.storage.store(file.path, key, 'public');
      await this.prisma.user.update({ where: { id: user.id }, data: { avatarUrl: this.storage.publicUrl(key) } });
    } finally {
      await rm(file.path, { force: true });
    }
    return this.current(user.id);
  }

  /**
   * Troca a senha e derruba as outras sessões. Devolve uma sessão nova, para
   * quem trocou continuar logado.
   */
  async changePassword(user: RequestUser, dto: ChangePasswordDto): Promise<AuthSession> {
    const conta = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { passwordHash: true, role: true } });
    if (!(await verifyPassword(dto.currentPassword, conta.passwordHash))) {
      // 400, não 401: o app derruba a sessão em qualquer 401.
      throw new BadRequestException({
        message: 'A senha atual não confere.',
        code: ErrorCode.WRONG_PASSWORD,
        fields: { currentPassword: 'A senha atual não confere.' },
      });
    }
    // Um segundo para trás: o token novo, emitido agora, não pode cair na mesma regra.
    const invalidaAntes = new Date(Math.floor(Date.now() / 1000) * 1000);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(dto.newPassword), sessionsValidAfter: invalidaAntes },
    });
    return this.auth.sessionFor(user.id, conta.role);
  }

  private async current(id: string): Promise<AuthUser> {
    const conta = await this.users.toAuthUser(id);
    if (!conta) throw new NotFoundException({ message: 'Usuário não encontrado.' });
    return conta;
  }
}

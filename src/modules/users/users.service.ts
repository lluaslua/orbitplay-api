import { Injectable, InternalServerErrorException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type {
  ArchetypeId,
  AuthUser,
  PlayerTypeId,
  StudioPermission,
  TestLocation,
} from '../../contracts';
import { PrismaService } from '../../prisma/prisma.service';

const comPerfil = {
  player: true,
  studio: { include: { _count: { select: { games: true } } } },
} satisfies Prisma.UserInclude;

export type UserWithProfile = Prisma.UserGetPayload<{ include: typeof comPerfil }>;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Contas de estúdio, jogador e administração, no formato do contrato (`AuthUser`). */
@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email: normalizeEmail(email) } });
  }

  async toAuthUser(id: string): Promise<AuthUser | null> {
    const user = await this.prisma.user.findUnique({ where: { id }, include: comPerfil });
    return user ? this.map(user) : null;
  }

  /** Posição no ranking: quantos jogadores estão à frente, em nível e XP, mais um. */
  async rankOf(level: number, xp: number): Promise<number> {
    const aFrente = await this.prisma.playerProfile.count({
      where: { OR: [{ level: { gt: level } }, { level, xp: { gt: xp } }] },
    });
    return aFrente + 1;
  }

  private async map(user: UserWithProfile): Promise<AuthUser> {
    const base = {
      id: user.id,
      name: user.name,
      email: user.email,
      status: user.status,
      avatarUrl: user.avatarUrl ?? undefined,
      locale: user.locale,
      createdAt: user.createdAt.toISOString(),
    };

    if (user.role === 'STUDIO') {
      if (!user.studio) throw new InternalServerErrorException('Conta de estúdio sem organização.');
      return {
        ...base,
        role: 'STUDIO',
        studio: {
          studioId: user.studio.id,
          permission: (user.studioPermission ?? 'VIEW') as StudioPermission,
          organization: user.studio.name,
          cnpj: user.studio.cnpj ?? undefined,
          website: user.studio.website ?? undefined,
          totalGames: user.studio._count.games,
          balance: user.studio.balanceCents,
        },
      };
    }

    if (user.role === 'PLAYER') {
      const perfil = user.player;
      if (!perfil) throw new InternalServerErrorException('Conta de jogador sem perfil.');
      const [rankPosition, conquistas] = await Promise.all([
        this.rankOf(perfil.level, perfil.xp),
        this.prisma.playerAchievement.findMany({
          where: { playerId: user.id },
          select: { achievementId: true },
          orderBy: { unlockedAt: 'asc' },
        }),
      ]);

      return {
        ...base,
        role: 'PLAYER',
        player: {
          level: perfil.level,
          xp: perfil.xp,
          xpToNextLevel: perfil.xpToNextLevel,
          balance: perfil.balanceCents,
          pendingBalance: perfil.pendingBalanceCents,
          completedSessions: perfil.completedSessions,
          rating: perfil.rating,
          rankPosition,
          badges: conquistas.map((conquista) => conquista.achievementId),
          tier: perfil.tier,
          achievementsCount: perfil.achievementsCount,
          hoursPlayed: Math.floor(perfil.secondsPlayed / 3600),
          location: perfil.location as TestLocation,
          playerType: perfil.playerType as PlayerTypeId,
          archetype: perfil.archetype as ArchetypeId,
          birthDate: perfil.birthDate?.toISOString().slice(0, 10),
          tutorialSeen: perfil.tutorialSeenAt !== null,
        },
      };
    }

    return { ...base, role: user.role };
  }
}

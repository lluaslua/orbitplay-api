import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { UserRole } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { RESET_TOKEN_TTL_MINUTES } from '../../common/constants/domain.constants';
import { ErrorCode } from '../../common/constants/error-codes';
import type { JwtPayload, RequestUser } from '../../common/interfaces/jwt-payload.interface';
import { MailService } from '../../common/mail/mail.service';
import type { AuthSession, AuthUser } from '../../contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { hashPassword, verifyPassword } from '../users/password';
import { normalizeEmail, UsersService } from '../users/users.service';
import type { LoginDto } from './dto/login.dto';
import type { RecoverPasswordDto } from './dto/recover-password.dto';
import type { RegisterDto } from './dto/register.dto';
import type { ResetPasswordDto } from './dto/reset-password.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
  ) {}

  /**
   * A mensagem de credencial inválida é a mesma para e-mail e senha (Tela 01,
   * RN-02). A aba escolhida não dá papel a ninguém: a sessão sai com o papel
   * da conta, e estúdio/jogador na aba errada é recusado (RN-03).
   */
  async login({ email, password, role, remember }: LoginDto): Promise<AuthSession> {
    const user = await this.users.findByEmail(email);
    const senhaConfere = await verifyPassword(password, user?.passwordHash);
    if (!user || !senhaConfere) {
      throw new UnauthorizedException({
        message: 'E-mail ou senha inválidos.',
        code: ErrorCode.INVALID_CREDENTIALS,
      });
    }

    if (user.status === 'INACTIVE') {
      throw new ForbiddenException({ message: 'Esta conta está desativada.', code: ErrorCode.ACCOUNT_INACTIVE });
    }
    if (user.status === 'PENDING') {
      throw new ForbiddenException({
        message: 'Defina sua senha pelo link do convite antes de entrar.',
        code: ErrorCode.ACCOUNT_PENDING,
      });
    }

    const administra = user.role === 'OWNER' || user.role === 'ADMIN';
    if (!administra && user.role !== role) {
      throw new ForbiddenException({
        message: `Esta conta é do tipo ${user.role === 'STUDIO' ? 'Estúdio' : 'Jogador'}. Troque a aba de login.`,
        code: ErrorCode.ROLE_MISMATCH,
      });
    }

    // "Último acesso" da tabela de Gerenciamento de acessos.
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return this.issueSession(user.id, user.role, remember ?? false);
  }

  async me(user: RequestUser): Promise<AuthUser> {
    const conta = await this.users.toAuthUser(user.id);
    if (!conta) throw new NotFoundException({ message: 'Usuário não encontrado.' });
    return conta;
  }

  /** "Criar nova conta": estúdio nasce com a organização e permissão de gestão (Tela 01, RN-05). */
  async register(dto: RegisterDto): Promise<AuthSession> {
    const email = normalizeEmail(dto.email);
    if (await this.prisma.user.findUnique({ where: { email }, select: { id: true } })) {
      throw new ConflictException({
        message: 'Já existe uma conta com este e-mail.',
        code: ErrorCode.EMAIL_TAKEN,
        fields: { email: 'Já existe uma conta com este e-mail.' },
      });
    }

    const passwordHash = await hashPassword(dto.password);
    const user = await this.prisma.$transaction(async (tx) => {
      if (dto.role === 'STUDIO') {
        const studio = await tx.studio.create({
          data: { name: dto.organization!.trim(), cnpj: dto.cnpj, website: dto.website },
        });
        return tx.user.create({
          data: {
            name: dto.name.trim(),
            email,
            passwordHash,
            role: 'STUDIO',
            studioId: studio.id,
            studioPermission: 'MANAGE',
            lastLoginAt: new Date(),
          },
        });
      }

      return tx.user.create({
        data: {
          name: dto.name.trim(),
          email,
          passwordHash,
          role: 'PLAYER',
          lastLoginAt: new Date(),
          player: {
            create: {
              birthDate: dto.birthDate ? new Date(dto.birthDate) : undefined,
              location: dto.location,
              playerType: dto.playerType === 'ALL' ? undefined : dto.playerType,
              archetype: dto.archetype === 'ALL' ? undefined : dto.archetype,
            },
          },
        },
      });
    });

    return this.issueSession(user.id, user.role, false);
  }

  /**
   * Primeiro passo da recuperação. A resposta é a mesma com ou sem conta, para
   * não revelar quais e-mails existem.
   */
  async recover({ email }: RecoverPasswordDto): Promise<{ message: string }> {
    const user = await this.users.findByEmail(email);
    if (user && user.status !== 'INACTIVE') await this.sendPasswordLink(user.id, user.email, 'Redefinição de senha');

    return {
      message: `Se existir uma conta para ${email}, enviaremos as instruções de recuperação.`,
    };
  }

  /** Também serve para o convite da Central de usuários: a conta PENDING vira ACTIVE. */
  async resetPassword({ token, password }: ResetPasswordDto): Promise<{ message: string }> {
    const registro = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: { select: { status: true } } },
    });
    if (!registro || registro.usedAt || registro.expiresAt < new Date() || registro.user.status === 'INACTIVE') {
      throw new BadRequestException({
        message: 'Este link de redefinição é inválido ou já expirou. Peça um novo.',
        code: ErrorCode.INVALID_RESET_TOKEN,
      });
    }

    const agora = new Date();
    const passwordHash = await hashPassword(password);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: registro.userId },
        // Tokens emitidos antes da troca deixam de valer.
        data: { passwordHash, status: 'ACTIVE', sessionsValidAfter: agora },
      }),
      this.prisma.passwordResetToken.updateMany({
        where: { userId: registro.userId, usedAt: null },
        data: { usedAt: agora },
      }),
    ]);

    return { message: 'Senha redefinida. Entre com a nova senha.' };
  }

  /** Gera o link de uso único e manda por e-mail. Usado também pelo convite da Central. */
  async sendPasswordLink(userId: string, email: string, assunto: string): Promise<void> {
    const token = randomBytes(32).toString('base64url');
    await this.prisma.passwordResetToken.create({
      data: {
        userId,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60_000),
      },
    });

    // O app usa HashRouter, então a rota vai depois do `#`.
    const link = `${this.config.getOrThrow<string>('app.url')}/#/reset-password?token=${token}`;
    await this.mail.send(email, assunto, `Use este link em até ${RESET_TOKEN_TTL_MINUTES} minutos:\n${link}`);
  }

  /** Sessão nova para quem já está logado — depois de trocar a senha, por exemplo. */
  sessionFor(userId: string, role: UserRole): Promise<AuthSession> {
    return this.issueSession(userId, role, false);
  }

  /** "Lembrar login" estende a sessão; sem ele, ela dura um expediente (Tela 01, RN-04). */
  private async issueSession(userId: string, role: UserRole, remember: boolean): Promise<AuthSession> {
    const segundos = this.config.getOrThrow<number>(
      remember ? 'jwt.rememberExpiresInSeconds' : 'jwt.expiresInSeconds',
    );
    const payload: JwtPayload = { sub: userId, role };
    const [token, user] = await Promise.all([
      this.jwt.signAsync(payload, { expiresIn: segundos }),
      this.users.toAuthUser(userId),
    ]);
    if (!user) throw new NotFoundException({ message: 'Usuário não encontrado.' });

    return { token, user, expiresAt: new Date(Date.now() + segundos * 1000).toISOString() };
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

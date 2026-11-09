import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { UserRole } from '@prisma/client';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { RateLimitStore, tooManyRequests } from '../../common/security/rate-limit.guard';
import { SecurityLogService } from '../../common/security/security-log.service';
import { TokenService } from '../../common/security/token.service';
import {
  EMAIL_CODE_MAX_ATTEMPTS,
  EMAIL_CODE_TTL_MINUTES,
  RESET_TOKEN_TTL_MINUTES,
} from '../../common/constants/domain.constants';
import { ErrorCode } from '../../common/constants/error-codes';
import type { JwtPayload, RequestUser } from '../../common/interfaces/jwt-payload.interface';
import { MailService } from '../../common/mail/mail.service';
import type { AuthSession, AuthUser, LoginResult, RegisterResult } from '../../contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { hashPassword, needsRehash, verifyPassword } from '../users/password';
import { normalizeEmail, UsersService } from '../users/users.service';
import type { LoginDto } from './dto/login.dto';
import type { RecoverPasswordDto } from './dto/recover-password.dto';
import type { RegisterDto } from './dto/register.dto';
import type { ResendCodeDto } from './dto/resend-code.dto';
import type { ResetPasswordDto } from './dto/reset-password.dto';
import type { VerifyEmailDto, VerifyLoginDto } from './dto/verify-email.dto';

/** Para que serve o código aberto: confirmar o cadastro ou o login com MFA. */
type CodePurpose = 'SIGNUP' | 'LOGIN';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly tokens: TokenService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
    private readonly limits: RateLimitStore,
    private readonly log: SecurityLogService,
  ) {}

  /**
   * A mensagem de credencial inválida é a mesma para e-mail e senha (Tela 01,
   * RN-02). A aba escolhida não dá papel a ninguém: a sessão sai com o papel
   * da conta, e estúdio/jogador na aba errada é recusado (RN-03).
   */
  async login({ email, password, role, remember }: LoginDto, ip = 'desconhecido'): Promise<LoginResult> {
    const maxFalhas = this.config.getOrThrow<number>('security.loginMaxFailures');
    const bloqueioMin = this.config.getOrThrow<number>('security.loginLockMinutes');
    const emailRef = SecurityLogService.emailRef(email);
    // O contador em memória vale também para e-mail inexistente: bloqueada ou não, a resposta é a mesma.
    const chave = `login:${emailRef}`;
    const user = await this.users.findByEmail(email);

    const travado = this.limits.isBlocked(chave, maxFalhas);
    if ((user?.lockedUntil && user.lockedUntil > new Date()) || travado.blocked) {
      this.log.event('login_blocked', { email: emailRef, ip });
      throw tooManyRequests(travado.retryAfter || bloqueioMin * 60);
    }

    const senhaConfere = await verifyPassword(password, user?.passwordHash);
    if (!user || !senhaConfere) {
      this.limits.hit(chave, maxFalhas, bloqueioMin * 60_000);
      if (user) await this.registerFailure(user.id, user.failedLoginCount, maxFalhas, bloqueioMin);
      this.log.event('login_failed', { email: emailRef, ip });
      throw new UnauthorizedException({
        message: 'E-mail ou senha inválidos.',
        code: ErrorCode.INVALID_CREDENTIALS,
      });
    }

    if (user.status === 'INACTIVE') {
      throw new ForbiddenException({ message: 'Esta conta está desativada.', code: ErrorCode.ACCOUNT_INACTIVE });
    }
    if (user.status === 'PENDING' && (await this.hasOpenVerification(user.id))) {
      // A senha confere, então é o dono do cadastro: um código novo e o app abre "Verifique seu e-mail".
      this.limits.clear(chave);
      await this.issueEmailCode(user.id, user.email, 'SIGNUP');
      throw new ForbiddenException({
        message: 'Confirme seu e-mail para entrar. Enviamos um novo código.',
        code: ErrorCode.EMAIL_NOT_VERIFIED,
      });
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

    this.limits.clear(chave);
    // "Último acesso" da tabela de Gerenciamento de acessos; acerto zera as falhas e, se o hash é antigo, refaz.
    // Com MFA, o último acesso só conta quando o código confere (`verifyLogin`).
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: user.mfaEnabled ? undefined : new Date(),
        failedLoginCount: 0,
        lockedUntil: null,
        ...(needsRehash(user.passwordHash) ? { passwordHash: await hashPassword(password) } : {}),
      },
    });

    if (user.mfaEnabled) {
      await this.issueEmailCode(user.id, user.email, 'LOGIN');
      return { mfaRequired: true, email: user.email };
    }
    return this.issueSession(user.id, user.role, remember ?? false);
  }

  /** Segundo passo do login com "MFA por E-mail". */
  async verifyLogin({ email, code, remember }: VerifyLoginDto): Promise<AuthSession> {
    const user = await this.consumeCode(email, code, 'LOGIN');
    if (user.status !== 'ACTIVE') {
      throw new ForbiddenException({ message: 'Esta conta está desativada.', code: ErrorCode.ACCOUNT_INACTIVE });
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return this.issueSession(user.id, user.role, remember ?? false);
  }

  private async registerFailure(userId: string, atuais: number, maxFalhas: number, bloqueioMin: number): Promise<void> {
    const total = atuais + 1;
    const trava = total >= maxFalhas;
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        failedLoginCount: trava ? 0 : total,
        lockedUntil: trava ? new Date(Date.now() + bloqueioMin * 60_000) : undefined,
      },
    });
  }

  /** Encerra o token apresentado. Sem token (ou inválido) não há o que revogar — e não é erro. */
  async logout(bearer: string | undefined): Promise<void> {
    const [tipo, token] = bearer?.split(' ') ?? [];
    if (tipo?.toLowerCase() !== 'bearer' || !token) return;
    try {
      const { jti, exp } = await this.tokens.verify<JwtPayload>('access', token);
      if (!jti || !exp) return;
      await this.prisma.revokedToken.upsert({
        where: { jti },
        create: { jti, expiresAt: new Date(exp * 1000) },
        update: {},
      });
    } catch {
      // token vencido ou inválido: nada a revogar.
    }
  }

  async me(user: RequestUser): Promise<AuthUser> {
    const conta = await this.users.toAuthUser(user.id);
    if (!conta) throw new NotFoundException({ message: 'Usuário não encontrado.' });
    return conta;
  }

  /**
   * "Criar conta": estúdio nasce com a organização e permissão de gestão (Tela 01, RN-05).
   * A conta nasce PENDING e só entra depois do código do e-mail (`verifyEmail`).
   */
  async register(dto: RegisterDto): Promise<RegisterResult> {
    const email = normalizeEmail(dto.email);
    if (await this.prisma.user.findUnique({ where: { email }, select: { id: true } })) {
      throw new ConflictException({
        message: 'Já existe uma conta com este e-mail.',
        code: ErrorCode.EMAIL_TAKEN,
        fields: { email: 'Já existe uma conta com este e-mail.' },
      });
    }

    const passwordHash = await hashPassword(dto.password);
    const conta = {
      status: 'PENDING' as const,
      termsAcceptedAt: new Date(),
      marketingOptIn: dto.marketingOptIn ?? false,
    };
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
            birthDate: dto.birthDate ? new Date(dto.birthDate) : undefined,
            location: dto.location,
            ...conta,
          },
        });
      }

      return tx.user.create({
        data: {
          name: dto.name.trim(),
          email,
          passwordHash,
          role: 'PLAYER',
          ...conta,
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

    // A conta já existe: se o e-mail falhar, a pessoa segue para "Verifique seu e-mail" e usa
    // "Reenviar código". Responder erro aqui faria a nova tentativa de cadastro dar EMAIL_TAKEN.
    await this.issueEmailCode(user.id, user.email, 'SIGNUP').catch(() =>
      this.log.event('signup_mail_failed', { userId: user.id }),
    );
    return { email: user.email };
  }

  /** "Verificar e-mail": o código certo e dentro do prazo ativa a conta e já entra. */
  async verifyEmail({ email, code }: VerifyEmailDto): Promise<AuthSession> {
    const user = await this.consumeCode(email, code, 'SIGNUP');
    await this.prisma.user.update({ where: { id: user.id }, data: { status: 'ACTIVE', lastLoginAt: new Date() } });
    return this.issueSession(user.id, user.role, false);
  }

  /**
   * "Reenviar código", do cadastro ou do login com MFA. A resposta é a mesma
   * com ou sem código aberto, para não revelar e-mails.
   */
  async resendCode({ email }: ResendCodeDto): Promise<{ message: string }> {
    const user = await this.users.findByEmail(email);
    const aberto = user
      ? await this.prisma.emailVerification.findUnique({ where: { userId: user.id }, select: { purpose: true } })
      : null;
    const valeAinda =
      (aberto?.purpose === 'SIGNUP' && user?.status === 'PENDING') ||
      (aberto?.purpose === 'LOGIN' && user?.status === 'ACTIVE');
    if (user && aberto && valeAinda) {
      await this.issueEmailCode(user.id, user.email, aberto.purpose as CodePurpose);
    }
    return { message: `Se houver um código aguardando confirmação para ${email}, enviamos um novo.` };
  }

  private async hasOpenVerification(userId: string): Promise<boolean> {
    return !!(await this.prisma.emailVerification.findFirst({ where: { userId, purpose: 'SIGNUP' }, select: { userId: true } }));
  }

  /**
   * Confere o código de 6 dígitos e o consome. Errado conta tentativa; vencido,
   * sem tentativas ou de outro propósito recebe a mesma resposta.
   */
  private async consumeCode(email: string, code: string, purpose: CodePurpose) {
    const user = await this.users.findByEmail(email);
    const registro = user
      ? await this.prisma.emailVerification.findUnique({ where: { userId: user.id } })
      : null;
    const invalido = new BadRequestException({
      message: 'Código inválido ou expirado. Confira o e-mail ou peça um novo código.',
      code: ErrorCode.INVALID_VERIFICATION_CODE,
      fields: { code: 'Código inválido ou expirado.' },
    });

    if (
      !user ||
      !registro ||
      registro.purpose !== purpose ||
      registro.expiresAt < new Date() ||
      registro.attempts >= EMAIL_CODE_MAX_ATTEMPTS
    ) {
      throw invalido;
    }
    if (registro.codeHash !== hashToken(code)) {
      await this.prisma.emailVerification.update({
        where: { userId: user.id },
        data: { attempts: { increment: 1 } },
      });
      this.log.event('email_code_failed', { userId: user.id, purpose });
      throw invalido;
    }

    await this.prisma.emailVerification.delete({ where: { userId: user.id } });
    return user;
  }

  /** Gera o código de 6 dígitos (o novo substitui o anterior) e manda por e-mail. */
  private async issueEmailCode(userId: string, email: string, purpose: CodePurpose): Promise<void> {
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const dados = {
      purpose,
      codeHash: hashToken(code),
      expiresAt: new Date(Date.now() + EMAIL_CODE_TTL_MINUTES * 60_000),
      attempts: 0,
    };
    await this.prisma.emailVerification.upsert({ where: { userId }, create: { userId, ...dados }, update: dados });
    await this.mail.send(
      email,
      'Seu código de verificação do OrbitPlay',
      `Seu código é ${code}. Ele expira em ${EMAIL_CODE_TTL_MINUTES} minutos.`,
    );
  }

  /**
   * Primeiro passo da recuperação. A resposta é a mesma com ou sem conta, para
   * não revelar quais e-mails existem.
   */
  async recover({ email }: RecoverPasswordDto): Promise<{ message: string }> {
    const user = await this.users.findByEmail(email);
    if (user && user.status !== 'INACTIVE') {
      // Em segundo plano: a resposta leva o mesmo tempo com ou sem conta.
      void this.sendPasswordLink(user.id, user.email, 'Redefinição de senha').catch(() =>
        this.log.event('recover_mail_failed', { email: SecurityLogService.emailRef(email) }),
      );
    }

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
        data: { passwordHash, status: 'ACTIVE', sessionsValidAfter: agora, failedLoginCount: 0, lockedUntil: null },
      }),
      this.prisma.passwordResetToken.updateMany({
        where: { userId: registro.userId, usedAt: null },
        data: { usedAt: agora },
      }),
    ]);

    this.log.event('password_reset', { userId: registro.userId });
    return { message: 'Senha redefinida. Entre com a nova senha.' };
  }

  /** Gera o link de uso único e manda por e-mail. Usado também pelo convite da Central. */
  async sendPasswordLink(userId: string, email: string, assunto: string): Promise<void> {
    const token = randomBytes(32).toString('base64url');
    // Um link só vale por vez: o pedido novo cancela os anteriores ainda abertos.
    await this.prisma.$transaction([
      this.prisma.passwordResetToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } }),
      this.prisma.passwordResetToken.create({
        data: {
          userId,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60_000),
        },
      }),
    ]);

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
      this.tokens.sign('access', payload as unknown as Record<string, unknown>, segundos),
      this.users.toAuthUser(userId),
    ]);
    if (!user) throw new NotFoundException({ message: 'Usuário não encontrado.' });

    return { token, user, expiresAt: new Date(Date.now() + segundos * 1000).toISOString() };
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

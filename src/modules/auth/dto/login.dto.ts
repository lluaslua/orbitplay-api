import { IsBoolean, IsEmail, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { LOGIN_TABS } from '../../../common/constants/domain.constants';
import type { LoginCredentials, LoginTab } from '../../../contracts';

export class LoginDto implements LoginCredentials {
  @IsEmail({}, { message: 'Informe um e-mail válido.' })
  email: string;

  @IsString()
  @IsNotEmpty({ message: 'Informe a senha.' })
  password: string;

  /** Aba escolhida na tela de login ("Sou um estúdio" / "Sou um tester"). */
  @IsIn(LOGIN_TABS)
  role: LoginTab;

  @IsOptional()
  @IsBoolean()
  remember?: boolean;
}

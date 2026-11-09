import { IsInt, IsNotEmpty, IsString, MaxLength, Min } from 'class-validator';
import { MIN_WITHDRAWAL_CENTS } from '../../../common/constants/domain.constants';
import type { WithdrawalRequest } from '../../../contracts';
import { IsPixKey } from '../pix-key';

export class WithdrawalDto implements WithdrawalRequest {
  @IsInt()
  @Min(MIN_WITHDRAWAL_CENTS, { message: 'Valor abaixo do saque mínimo.' })
  amountCents: number;

  @IsString()
  @IsNotEmpty({ message: 'Informe a chave Pix.' })
  @MaxLength(140)
  @IsPixKey()
  pixKey: string;
}

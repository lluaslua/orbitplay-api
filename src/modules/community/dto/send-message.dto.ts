import { IsOptional, IsString } from 'class-validator';

export class SendMessageDto {
  /**
   * Vazio e tamanho são checados no service, depois do trim, para responder
   * com os códigos EMPTY_MESSAGE e MESSAGE_TOO_LONG que o mock já devolve.
   */
  @IsString()
  text: string;
}

/** `?after=<id ou data>` para o polling; `?before=<id ou data>` para o histórico. */
export class ListMessagesQueryDto {
  @IsOptional()
  @IsString()
  after?: string;

  @IsOptional()
  @IsString()
  before?: string;
}

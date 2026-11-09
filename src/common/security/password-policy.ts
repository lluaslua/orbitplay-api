import { registerDecorator, type ValidationOptions } from 'class-validator';

/** Senhas que aparecem em qualquer lista de vazamentos — recusadas mesmo com 8 caracteres. */
const COMUNS = new Set([
  '12345678', '123456789', '1234567890', '11111111', '00000000', '87654321', 'password', 'password1', 'passw0rd',
  'qwertyui', 'qwerty123', 'qwertyuiop', 'abc12345', 'abcd1234', 'senha123', 'senha1234', 'senha@123', 'mudar123',
  'admin123', 'iloveyou', 'letmein1', 'welcome1', 'orbitplay', 'orbitplay1', 'orbitplay123', 'brasil123', 'futebol1',
]);

export const PASSWORD_MIN = 8;
/** O bcrypt só lê 72 BYTES: acima disso o resto seria ignorado em silêncio. */
export const PASSWORD_MAX_BYTES = 72;

export const WEAK_PASSWORD_MESSAGE =
  'Use de 8 a 72 caracteres, com letras e números, e evite senhas comuns.';

/** Devolve a mensagem do problema, ou `null` se a senha serve. */
export function passwordProblem(senha: unknown): string | null {
  if (typeof senha !== 'string') return WEAK_PASSWORD_MESSAGE;
  if (senha.length < PASSWORD_MIN) return 'A senha precisa de pelo menos 8 caracteres.';
  if (Buffer.byteLength(senha, 'utf8') > PASSWORD_MAX_BYTES) return 'A senha passa de 72 bytes.';
  if (!/\p{L}/u.test(senha) || !/\d/.test(senha)) return WEAK_PASSWORD_MESSAGE;
  if (COMUNS.has(senha.toLowerCase())) return WEAK_PASSWORD_MESSAGE;
  if (/^(.)\1+$/.test(senha)) return WEAK_PASSWORD_MESSAGE;
  return null;
}

/** `@IsStrongPassword()` — a regra única de senha nova (cadastro, troca, redefinição, definição pelo ADM). */
export function IsStrongPassword(options?: ValidationOptions) {
  return (object: object, propertyName: string): void => {
    registerDecorator({
      name: 'isStrongPassword',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate: (valor: unknown) => passwordProblem(valor) === null,
        defaultMessage: (args) => passwordProblem(args?.value) ?? WEAK_PASSWORD_MESSAGE,
      },
    });
  };
}

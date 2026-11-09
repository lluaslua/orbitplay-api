import { registerDecorator, type ValidationOptions } from 'class-validator';

const EMAIL = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
const ALEATORIA = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PixKeyType = 'CPF' | 'CNPJ' | 'PHONE' | 'EMAIL' | 'RANDOM';

/** Os cinco formatos de chave Pix; qualquer outra coisa não é chave. Só o formato — o Pix é simulado. */
export function pixKeyType(valor: string): PixKeyType | null {
  const chave = valor.trim();
  const digitos = chave.replace(/[.\-/\s]/g, '');
  if (/^\d{11}$/.test(digitos) && !/^(\d)\1{10}$/.test(digitos)) return 'CPF';
  if (/^\d{14}$/.test(digitos) && !/^(\d)\1{13}$/.test(digitos)) return 'CNPJ';
  if (/^\+55\d{10,11}$/.test(chave.replace(/[\s()-]/g, ''))) return 'PHONE';
  if (chave.length <= 77 && EMAIL.test(chave)) return 'EMAIL';
  if (ALEATORIA.test(chave)) return 'RANDOM';
  return null;
}

/** `@IsPixKey()` — a chave de saque tem de ser CPF, CNPJ, telefone (+55), e-mail ou chave aleatória. */
export function IsPixKey(options?: ValidationOptions) {
  return (object: object, propertyName: string): void => {
    registerDecorator({
      name: 'isPixKey',
      target: object.constructor,
      propertyName,
      options: { message: 'Informe uma chave Pix válida: CPF, CNPJ, telefone com +55, e-mail ou chave aleatória.', ...options },
      validator: { validate: (valor: unknown) => typeof valor === 'string' && pixKeyType(valor) !== null },
    });
  };
}

/** Como a chave é guardada: CPF, CNPJ e telefone só com dígitos; e-mail em minúsculas. */
export function normalizePixKey(valor: string): string {
  const chave = valor.trim();
  switch (pixKeyType(chave)) {
    case 'CPF':
    case 'CNPJ':
      return chave.replace(/\D/g, '');
    case 'PHONE':
      return `+${chave.replace(/\D/g, '')}`;
    case 'EMAIL':
    case 'RANDOM':
      return chave.toLowerCase();
    default:
      return chave;
  }
}

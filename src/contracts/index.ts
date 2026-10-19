export * from './auth';
export * from './game';
export * from './test';
export * from './player';
export * from './report';
export * from './community';
// Só na API por enquanto — o app copia quando integrar estas telas.
export * from './pricing';
export * from './build';
export * from './payment';
export * from './wallet';
export * from './gameplay';
export * from './admin';
export * from './team';
export * from './plugin';
export * from './notification';
export * from './ranking';
export * from './access';

/** Envelope usado por toda a camada mock - espelha o formato previsto da API real. */
export interface ApiResponse<T> {
  data: T;
  message?: string;
}

export interface ApiError {
  message: string;
  code?: string;
  fields?: Record<string, string>;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

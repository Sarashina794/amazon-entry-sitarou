export type EntryResult = {
  JANCode: string;
  price?: number;
  stock?: number;
  success: boolean;
  errorType?: ErrorType;
  errorMessage?: string;
};

export const ERROR_TYPE = {
  TIME_OUT: 'TIME_OUT',
  BLAND_ENTRY: 'BLAND_ENTRY',
  NOT_FOUND: 'NOT_FOUND',
  INVALID_INPUT: 'INVALID_INPUT',
} as const;

export type ErrorType = (typeof ERROR_TYPE)[keyof typeof ERROR_TYPE];

export const ACCOUNT_NAME = {
  'FIVES WORKWEAR': 'FIVES WORKWEAR',
  'ワークウェアショップ KeyPoint': 'ワークウェアショップ KeyPoint',
} as const;

export type AccountName = (typeof ACCOUNT_NAME)[keyof typeof ACCOUNT_NAME];

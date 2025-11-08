import { ERROR_TYPE, type ErrorType } from '@/app/types';

const descriptions: Record<ErrorType, string> = {
  [ERROR_TYPE.TIME_OUT]:
    '予期していないエラーによってエントリーできませんでした',
  [ERROR_TYPE.BLAND_ENTRY]:
    'ブランド出品許可が必要な商品です。セラーセントラルで許可申請を行ってから再度お試しください。',
  [ERROR_TYPE.NOT_FOUND]:
    '相乗り出品できませんでした。新規出品が必要です',
  [ERROR_TYPE.INVALID_INPUT]:
    'SKUの重複か、在庫/価格などの入力値に誤りがあります。',
};

/**
 * エラー種別ごとの説明文を返します。
 */
export const getErrorTypeDescription = (type?: ErrorType): string => {
  if (!type) {
    return '詳細情報がありません。';
  }
  return descriptions[type] ?? '詳細情報がありません。';
};

export type { ErrorType } from '@/app/types';

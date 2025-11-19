import type { EntryPageConfig } from './createEntryPage';

const JAN_PATTERN = /^\d{13}$/;
const ASIN_PATTERN = /^[A-Z0-9]{10}$/i;

export const JAN_ENTRY_CONFIG: EntryPageConfig = {
  identifierLabel: 'JAN',
  pageTitle: 'JAN で商品エントリー',
  pageDescription: 'JAN コードを利用して相乗り出品を自動登録します。',
  sampleCsv: `JAN,price,stock
4549957721409,11800,5
4549957722512,9800,3
4974019907609,5980,12
4580053450012,7800,8
4984824921234,4500,20`,
  storageKeyPrefix: 'amazon-entry-jan',
  csvEntryKeys: ['jan', 'productid'],
  identifierValidator: (value: string): string | null => {
    if (!JAN_PATTERN.test(value)) {
      return 'JAN は13桁の数字で入力してください';
    }
    return null;
  },
  searchType: 'JAN',
};

export const ASIN_ENTRY_CONFIG: EntryPageConfig = {
  identifierLabel: 'SKU',
  pageTitle: 'ASIN で商品エントリー',
  pageDescription: 'SKU / ASIN を分けて入力し、ASIN で検索・SKU で登録するモードです。',
  sampleCsv: `SKU,ASIN,price,stock
SKU-ABC123,B0A1BC2D3E,11800,5
SKU-DEF456,B0F4GH5I6J,9800,3
SKU-GHI789,B0K7LM8N9O,5980,12
SKU-JKL012,B0P1QR2S3T,7800,8
SKU-MNO345,B0U4VW5X6Y,4500,20`,
  storageKeyPrefix: 'amazon-entry-asin',
  csvEntryKeys: ['sku'],
  identifierValidator: (value: string): string | null => {
    if (!value?.trim()) {
      return 'SKU を入力してください';
    }
    return null;
  },
  searchType: 'ASIN',
  searchField: {
    label: 'ASIN',
    csvKeys: ['asin'],
    validator: (value: string): string | null => {
      if (!ASIN_PATTERN.test(value.trim())) {
        return 'ASIN は10桁の英数字で入力してください';
      }
      return null;
    },
  },
};

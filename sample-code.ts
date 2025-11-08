import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';
import {
  buildSuccessResult,
  ensureAccountName,
  enterProductDetails,
  isTimeoutError,
  launchAmazonBrowser,
  searchAinoriProduct,
  signInAmazon,
} from './app/services/amazon-operations';
import { ERROR_TYPE, type EntryItem, type EntryResult, type AccountName } from './app/types';

const STORAGE_STATE_PATH = process.env.STORAGE_STATE_PATH ?? 'state.json';
const SHOULD_PERSIST_STATE = process.env.PERSIST_STORAGE_STATE !== 'false';
const LISTING_CSV_PATH = process.env.LISTING_CSV_PATH ?? 'new-entry-list.csv';
const RESULT_CSV_PATH = process.env.RESULT_CSV_PATH ?? 'result.csv';
const REGION_NAME = process.env.REGION_NAME ?? '日本';
const LISTING_PROCESS_TIMEOUT_MS = (() => {
  const parsed = Number.parseInt(
    process.env.LISTING_PROCESS_TIMEOUT_MS ?? '',
    10,
  );
  return Number.isNaN(parsed) ? 50_000 : parsed;
})();
const HEADLESS =
  process.env.HEADLESS != null ? process.env.HEADLESS !== 'false' : false;
const SLOW_MO = process.env.SLOW_MO
  ? Number.parseInt(process.env.SLOW_MO, 10)
  : undefined;

const SIGN_IN_EMAIL =
  process.env.AMAZON_EMAIL ?? process.env.LOGIN_EMAIL ?? '';
const SIGN_IN_PASSWORD =
  process.env.AMAZON_PASSWORD ?? process.env.LOGIN_PASSWORD ?? '';
const SIGN_IN_OTP_SECRET =
  process.env.AMAZON_OTP_SECRET ??
  process.env.OTP_SECRET ??
  process.env.AUTHENTICATOR_SECRET ??
  '';

const sanitizeNumericValue = (value: string | undefined, fallback: string): string => {
  if (!value) {
    return fallback;
  }
  const cleaned = value.replace(/"/g, '').replace(/,/g, '').trim();
  return cleaned.length > 0 ? cleaned : fallback;
};

const loadItemsFromCsv = (path: string): EntryItem[] => {
  if (!existsSync(path)) {
    return [];
  }

  const raw = readFileSync(path, 'utf8').trim();
  if (!raw) {
    return [];
  }

  const records = parse(raw, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    delimiter: ['\t', ','],
    relax_column_count: true,
  }) as Record<string, string>[];

  return records
    .map((record) => {
      const normalized = Object.fromEntries(
        Object.entries(record).map(([key, value]) => [
          key.trim().toLowerCase(),
          typeof value === 'string' ? value.trim() : value,
        ]),
      );

      const JANCode =
        (normalized.jan as string | undefined) ??
        (normalized.productid as string | undefined) ??
        '';
      if (!JANCode) {
        return null;
      }

      const price = sanitizeNumericValue(
        normalized.price as string | undefined,
        process.env.PRODUCT_PRICE ?? '6890',
      );
      const stock = sanitizeNumericValue(
        normalized.stock as string | undefined,
        process.env.INVENTORY_COUNT ?? '0',
      );

      return {
        JANCode,
        price: Number.parseInt(price, 10) || 0,
        stock: Number.parseInt(stock, 10) || 0,
      } satisfies EntryItem;
    })
    .filter((item): item is EntryItem => item !== null);
};

const writeResultsCsv = (results: EntryResult[]): void => {
  const header = 'JANCode,success,errorType,errorMessage\n';
  const body = results
    .map((result) =>
      [
        result.JANCode,
        String(result.success),
        result.errorType ?? '',
        result.errorMessage ?? '',
      ].join(','),
    )
    .join('\n');
  writeFileSync(RESULT_CSV_PATH, body.length ? `${header}${body}\n` : header, 'utf8');
};

async function run(): Promise<void> {
  if (!SIGN_IN_EMAIL || !SIGN_IN_PASSWORD || !SIGN_IN_OTP_SECRET) {
    throw new Error('Amazon のサインイン情報が設定されていません。');
  }

  const items = loadItemsFromCsv(LISTING_CSV_PATH);
  if (items.length === 0) {
    throw new Error('CSV から出品対象を取得できませんでした。');
  }

  const accountName = ensureAccountName(process.env.ACCOUNT_NAME as AccountName | undefined);
  const { browser, context, page, persistState } = await launchAmazonBrowser({
    headless: HEADLESS,
    slowMo: SLOW_MO,
    timeoutMs: LISTING_PROCESS_TIMEOUT_MS,
    storageStatePath: STORAGE_STATE_PATH,
    shouldPersistState: SHOULD_PERSIST_STATE,
  });

  const results: EntryResult[] = [];

  try {
    await signInAmazon({
      page,
      email: SIGN_IN_EMAIL,
      password: SIGN_IN_PASSWORD,
      otpSecret: SIGN_IN_OTP_SECRET,
      accountName,
      regionName: REGION_NAME,
    });

    for (const item of items) {
      try {
        const searchResult = await searchAinoriProduct(page, item.JANCode);
        if (searchResult.error) {
          results.push(searchResult.error);
          console.log(`${item.JANCode}: ${searchResult.error.errorMessage}`);
          continue;
        }

        const entryResult = await enterProductDetails(searchResult.listingPage!, item);
        if (entryResult) {
          results.push(entryResult);
          console.log(`${item.JANCode}: ${entryResult.errorMessage}`);
          continue;
        }

        const successResult = buildSuccessResult(item);
        results.push(successResult);
        console.log(`${item.JANCode}: 出品完了`);
      } catch (error) {
        const failure: EntryResult = isTimeoutError(error)
          ? {
              JANCode: item.JANCode,
              success: false,
              errorType: ERROR_TYPE.TIME_OUT,
              errorMessage: 'タイムアウトが発生しました。',
            }
          : {
              JANCode: item.JANCode,
              success: false,
              errorType: ERROR_TYPE.INVALID_INPUT,
              errorMessage:
                error instanceof Error ? error.message : '不明なエラーが発生しました。',
            };
        results.push(failure);
        console.error(`${item.JANCode}: ${failure.errorMessage}`);
        if (!isTimeoutError(error)) {
          throw error;
        }
      }
    }

    await persistState();
  } finally {
    await context.close();
    await browser.close();
    writeResultsCsv(results);
  }
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

import { NextRequest, NextResponse } from 'next/server';
import {
  buildSuccessResult,
  ensureAccountName,
  enterProductDetails,
  isTimeoutError,
  launchAmazonBrowser,
  searchAinoriProduct,
  signInAmazon,
} from '@/app/services/amazon-operations';
import {
  ACCOUNT_NAME,
  type AccountName,
  type EntryItem,
  type EntryResult,
  ERROR_TYPE,
} from '@/app/types';
import type { PostAmazonEntryRequest } from '@/app/dto';

export const runtime = 'nodejs';

const SIGN_IN_EMAIL =
  process.env.LOGIN_EMAIL;
const SIGN_IN_PASSWORD =
  process.env.LOGIN_PASSWORD;
const SIGN_IN_OTP_SECRET =
  process.env.AUTHENTICATOR_SECRET;

type RunStatus = 'idle' | 'running' | 'completed' | 'error' | 'aborted';
const LISTING_PROCESS_TIMEOUT_MS = 10000;
interface ProgressState {
  total: number;
  processed: number;
}

interface PublicRunState {
  status: RunStatus;
  progress: ProgressState;
  results: EntryResult[];
  runId?: string;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
  accountName?: AccountName;
  headless?: boolean;
  currentProductId?: string;
  lastMessage?: string;
  resultCsv?: string;
}

interface InternalRunState extends PublicRunState {
  controller?: AbortController;
  runPromise?: Promise<void>;
}

const ACCOUNT_OPTIONS = Object.values(ACCOUNT_NAME) as AccountName[];

let runCounter = 0;
let runState: InternalRunState = {
  status: 'idle',
  progress: { total: 0, processed: 0 },
  results: [],
};

/**
 * CSV に書き出す値をクォート・エスケープします。
 */
function escapeCsvValue(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * 出品結果の配列をダウンロード用 CSV テキストに変換します。
 */
function buildResultCsv(results: EntryResult[]): string {
  const header = 'JAN,price,stock,errorType,errorMessage';
  const body = results
    .map((result) =>
      [
        result.JANCode,
        result.price?.toString() ?? '',
        result.stock?.toString() ?? '',
        result.errorType ?? '',
        result.errorMessage ?? '',
      ]
        .map(escapeCsvValue)
        .join(','),
    )
    .join('\n');
  return body ? `${header}\n${body}` : `${header}\n`;
}

/**
 * 内部で保持している実行状態から、クライアントへ返す情報だけを抽出します。
 */
function serializeState(): PublicRunState {
  const { controller, runPromise, ...rest } = runState;
  void controller;
  void runPromise;
  return rest;
}

/**
 * 現在の実行ステータスを取得するエンドポイント。
 */
export async function GET(): Promise<NextResponse<PublicRunState>> {
  return NextResponse.json(serializeState());
}

/**
 * 進行中の出品処理を強制停止するエンドポイント。
 */
export async function DELETE(): Promise<NextResponse<PublicRunState>> {
  if (runState.status !== 'running' || !runState.controller) {
    return NextResponse.json(serializeState(), { status: 409 });
  }

  runState.controller.abort();
  return NextResponse.json(serializeState());
}

/**
 * 出品処理を開始するエンドポイント。CSV から渡されたレコードを順次登録します。
 */
export async function POST(
  request: NextRequest,
): Promise<NextResponse<PublicRunState | { error: string }>> {
  if (runState.status === 'running') {
    return NextResponse.json(
      { error: '既に実行中です。完了または停止を待ってください。' },
      { status: 409 },
    );
  }

  let payload: PostAmazonEntryRequest;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'リクエストボディの解析に失敗しました。' },
      { status: 400 },
    );
  }

  const records = payload.EntryItems ?? [];
  if (!Array.isArray(records) || records.length === 0) {
    return NextResponse.json(
      { error: '出品対象のレコードが存在しません。' },
      { status: 400 },
    );
  }

  const accountName =
    payload.accountName;
  if (!ACCOUNT_OPTIONS.includes(accountName)) {
    return NextResponse.json(
      { error: '選択できないアカウント名が指定されました。' },
      { status: 400 },
    );
  }

  const sanitizedRecords: EntryItem[] = records.map((record) => {
    const janValue =
      (record as EntryItem).JANCode ??
      (record as { productId?: string }).productId ??
      '';
    const priceValue = Number(
      (record as EntryItem).price ?? (record as { price?: number | string }).price,
    );
    const stockValue = Number(
      (record as EntryItem).stock ?? (record as { stock?: number | string }).stock,
    );

    return {
      JANCode: String(janValue).trim(),
      price: priceValue,
      stock: stockValue,
    };
  });

  if (sanitizedRecords.some((record) => !record.JANCode)) {
    return NextResponse.json(
      { error: 'JAN が空のレコードがあります。' },
      { status: 400 },
    );
  }

  if (
    sanitizedRecords.some(
      (record) =>
        !Number.isFinite(record.price) ||
        !Number.isFinite(record.stock) ||
        record.price < 0 ||
        record.stock < 0,
    )
  ) {
    return NextResponse.json(
      { error: 'price と stock には 0 以上の数値を指定してください。' },
      { status: 400 },
    );
  }

  const controller = new AbortController();
  const runId = `${Date.now()}-${++runCounter}`;

  runState = {
    status: 'running',
    progress: { total: sanitizedRecords.length, processed: 0 },
    results: [],
    runId,
    startedAt: Date.now(),
    finishedAt: undefined,
    error: undefined,
    accountName,
    headless: payload.isHeadless,
    controller,
    currentProductId: undefined,
    lastMessage: undefined,
    resultCsv: undefined,
  };

  const runPromise = (async () => {
    const { browser, context, page } = await launchAmazonBrowser({
      headless: runState.headless,
      timeoutMs: LISTING_PROCESS_TIMEOUT_MS,
    });

    const abortHandler = async (): Promise<void> => {
      try {
        await context.close();
      } catch {
        // noop
      }
      try {
        await browser.close();
      } catch {
        // noop
      }
    };

    controller.signal.addEventListener('abort', abortHandler, { once: true });

    const ensureProgressUpdate = (processed: number, total: number): void => {
      runState.progress = { total, processed };
    };

    const total = sanitizedRecords.length;
    let processed = 0;
    let lastMessage: string | undefined;
    const accountToUse = ensureAccountName(accountName);

    const pushResult = (result: EntryResult, source: EntryItem): void => {
      if (result.errorMessage) {
        lastMessage = result.errorMessage;
      }
      const enrichedResult: EntryResult = {
        price: source.price,
        stock: source.stock,
        ...result,
      };
      const nextResults = [...runState.results, enrichedResult];
      runState.results = nextResults;
      runState.lastMessage = result.errorMessage ?? lastMessage;
    };

    try {
      // 環境変数を確認
      if (!SIGN_IN_EMAIL || !SIGN_IN_PASSWORD || !SIGN_IN_OTP_SECRET) {
        throw new Error('Amazon のサインイン情報が設定されていません。');
      }
      await signInAmazon({
        page,
        email: SIGN_IN_EMAIL,
        password: SIGN_IN_PASSWORD,
        otpSecret: SIGN_IN_OTP_SECRET,
        accountName: accountToUse,
      });

      ensureProgressUpdate(processed, total);

      for (const record of sanitizedRecords) {
        if (controller.signal.aborted) {
          throw new Error('ユーザーによって処理が中断されました。');
        }

        runState.currentProductId = record.JANCode;
        lastMessage = undefined;

        try {
          const searchResult = await searchAinoriProduct(page, record.JANCode);
          if (searchResult.error) {
            pushResult(searchResult.error, record);
            processed += 1;
            ensureProgressUpdate(processed, total);
            continue;
          }

          const entryResult = await enterProductDetails(
            searchResult.listingPage!,
            record,
          );
          if (entryResult) {
            pushResult(entryResult, record);
            processed += 1;
            ensureProgressUpdate(processed, total);
            continue;
          }

          const successResult = buildSuccessResult(record);
          lastMessage = '出品が完了しました。';
          pushResult(successResult, record);
          processed += 1;
          ensureProgressUpdate(processed, total);
        } catch (error) {
          const entryResult: EntryResult = isTimeoutError(error)
            ? {
                JANCode: record.JANCode,
                success: false,
                errorType: ERROR_TYPE.TIME_OUT,
                errorMessage: '処理がタイムアウトしました。',
              }
            : {
                JANCode: record.JANCode,
                success: false,
                errorType: ERROR_TYPE.INVALID_INPUT,
                errorMessage:
                  error instanceof Error
                    ? error.message
                    : '不明なエラーが発生しました。',
              };
          pushResult(entryResult, record);
          processed += 1;
          ensureProgressUpdate(processed, total);
          if (!isTimeoutError(error)) {
            throw error;
          }
        }
      }

      runState.finishedAt = Date.now();
      runState.status = controller.signal.aborted ? 'aborted' : 'completed';
      runState.resultCsv = buildResultCsv(runState.results);
      runState.currentProductId = undefined;
      runState.controller = undefined;
    } finally {
      controller.signal.removeEventListener('abort', abortHandler);
      runState.currentProductId = undefined;
      try {
        await context.close();
      } catch {
        // noop
      }
      try {
        await browser.close();
      } catch {
        // noop
      }
    }
  })().catch((error: unknown) => {
    runState.finishedAt = Date.now();
    if (controller.signal.aborted) {
      runState.status = 'aborted';
    } else {
      runState.status = 'error';
      runState.error =
        error instanceof Error ? error.message : '不明なエラーが発生しました。';
    }
    runState.resultCsv = buildResultCsv(runState.results);
    runState.controller = undefined;
  });

  runState.runPromise = runPromise;

  return NextResponse.json(serializeState(), { status: 202 });
}

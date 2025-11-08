import { NextRequest, NextResponse } from 'next/server';
import {
  runAmazonEntry,
  type ListingResult,
  type ListingTask,
  type AccountName,
} from '@/sample-code';

export const runtime = 'nodejs';

type RunStatus = 'idle' | 'running' | 'completed' | 'error' | 'aborted';

interface ProgressState {
  total: number;
  processed: number;
}

interface PublicRunState {
  status: RunStatus;
  progress: ProgressState;
  results: ListingResult[];
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

const ACCOUNT_OPTIONS: AccountName[] = [
  'FIVES WORKWEAR',
  'ワークウェアショップ KeyPoint',
];

let runCounter = 0;
let runState: InternalRunState = {
  status: 'idle',
  progress: { total: 0, processed: 0 },
  results: [],
};

function escapeCsvValue(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function buildResultCsv(results: ListingResult[]): string {
  const header = 'productId,status,message';
  const body = results
    .map((result) =>
      [result.productId, result.status, result.message].map(escapeCsvValue).join(','),
    )
    .join('\n');
  return body ? `${header}\n${body}` : `${header}\n`;
}

function serializeState(): PublicRunState {
  const { controller, runPromise, ...rest } = runState;
  void controller;
  void runPromise;
  return rest;
}

export async function GET(): Promise<NextResponse<PublicRunState>> {
  return NextResponse.json(serializeState());
}

export async function DELETE(): Promise<NextResponse<PublicRunState>> {
  if (runState.status !== 'running' || !runState.controller) {
    return NextResponse.json(serializeState(), { status: 409 });
  }

  runState.controller.abort();
  return NextResponse.json(serializeState());
}

export async function POST(
  request: NextRequest,
): Promise<NextResponse<PublicRunState | { error: string }>> {
  if (runState.status === 'running') {
    return NextResponse.json(
      { error: '既に実行中です。完了または停止を待ってください。' },
      { status: 409 },
    );
  }

  let payload: {
    records?: ListingTask[];
    showBrowser?: boolean;
    accountName?: AccountName;
  };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'リクエストボディの解析に失敗しました。' },
      { status: 400 },
    );
  }

  const records = payload.records ?? [];
  if (!Array.isArray(records) || records.length === 0) {
    return NextResponse.json(
      { error: '出品対象のレコードが存在しません。' },
      { status: 400 },
    );
  }

  const accountName = payload.accountName ?? 'ワークウェアショップ KeyPoint';
  if (!ACCOUNT_OPTIONS.includes(accountName)) {
    return NextResponse.json(
      { error: '選択できないアカウント名が指定されました。' },
      { status: 400 },
    );
  }

  const sanitizedRecords: ListingTask[] = records.map((record) => ({
    productId: String(record.productId ?? '').trim(),
    price: String(record.price ?? '').trim(),
    stock: String(record.stock ?? '').trim(),
  }));

  if (sanitizedRecords.some((record) => !record.productId)) {
    return NextResponse.json(
      { error: 'JAN が空のレコードがあります。' },
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
    headless: !(payload.showBrowser ?? false),
    controller,
    currentProductId: undefined,
    lastMessage: undefined,
    resultCsv: undefined,
  };

  const runPromise = runAmazonEntry({
    tasks: sanitizedRecords,
    headless: runState.headless,
    accountName,
    abortSignal: controller.signal,
    onListingProgress: ({ total, processed, productId, status, message }) => {
      runState.progress = { total, processed };
      if (productId) {
        runState.currentProductId = productId;
      }
      if (message) {
        runState.lastMessage = message;
      }
      if (status === 'completed') {
        runState.currentProductId = undefined;
      }
    },
  })
    .then((results) => {
      runState.results = results;
      runState.finishedAt = Date.now();
      runState.status = controller.signal.aborted ? 'aborted' : 'completed';
      runState.resultCsv = buildResultCsv(results);
      runState.controller = undefined;
    })
    .catch((error: unknown) => {
      runState.finishedAt = Date.now();
      runState.results = runState.results.length ? runState.results : [];
      if (controller.signal.aborted) {
        runState.status = 'aborted';
      } else {
        runState.status = 'error';
        runState.error = error instanceof Error ? error.message : '不明なエラーが発生しました。';
      }
      runState.controller = undefined;
    });

  runState.runPromise = runPromise;

  return NextResponse.json(serializeState(), { status: 202 });
}

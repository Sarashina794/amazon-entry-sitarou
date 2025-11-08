'use client';

import type { ChangeEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parse } from 'csv-parse/browser/esm/sync';
import {
  ACCOUNT_NAME,
  type AccountName,
  type EntryItem,
  type EntryResult,
} from '@/app/types';
import type { PostAmazonEntryRequest } from '@/app/dto';

type RunStatus = 'idle' | 'running' | 'completed' | 'error' | 'aborted';

interface ApiState {
  status: RunStatus;
  progress: { total: number; processed: number };
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

interface ParsedRecord {
  id: string;
  productId: string;
  price: string;
  stock: string;
  errors: string[];
}

const ACCOUNT_OPTIONS = Object.values(ACCOUNT_NAME) as AccountName[];

const STATUS_LABEL: Record<RunStatus, string> = {
  idle: '待機中',
  running: '実行中',
  completed: '完了',
  error: 'エラー',
  aborted: '強制停止',
};

const JAN_PATTERN = /^\d{13}$/;

const normalizeNumericString = (value: string): string =>
  value.replace(/,/g, '').trim();

function validateRecord(record: Omit<ParsedRecord, 'id' | 'errors'>): string[] {
  const errors: string[] = [];
  if (!JAN_PATTERN.test(record.productId)) {
    errors.push('JAN は13桁の数字で入力してください');
  }

  const priceValue = Number(normalizeNumericString(record.price));
  if (!Number.isFinite(priceValue) || priceValue < 0) {
    errors.push('price は 0 以上の数値で入力してください');
  }

  const stockValue = Number(normalizeNumericString(record.stock));
  if (!Number.isFinite(stockValue) || stockValue < 0) {
    errors.push('stock は 0 以上の数値で入力してください');
  }

  return errors;
}

function buildParsedRecords(text: string): ParsedRecord[] {
  const rows = parse(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];

  return rows.map((row, index) => {
    const normalized = Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key.trim().toLowerCase(),
        value?.trim?.() ?? value ?? '',
      ]),
    );
    const productId =
      (normalized.jan as string | undefined) ??
      (normalized.productid as string | undefined) ??
      '';
    const price = (normalized.price as string | undefined) ?? '';
    const stock = (normalized.stock as string | undefined) ?? '';

    const baseRecord = {
      id: `${Date.now()}-${index}`,
      productId,
      price,
      stock,
    };
    return {
      ...baseRecord,
      errors: validateRecord(baseRecord),
    };
  });
}

export default function HomePage(): JSX.Element {
  const [records, setRecords] = useState<ParsedRecord[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBrowser, setShowBrowser] = useState(true);
  const [accountName, setAccountName] = useState<AccountName>(
    'ワークウェアショップ KeyPoint',
  );
  const [status, setStatus] = useState<RunStatus>('idle');
  const [progress, setProgress] = useState<{ total: number; processed: number }>(
    { total: 0, processed: 0 },
  );
  const [results, setResults] = useState<EntryResult[]>([]);
  const [resultCsv, setResultCsv] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [currentProductId, setCurrentProductId] = useState<string | undefined>();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const selectedRecords = useMemo(
    () => records.filter((record) => selectedIds.has(record.id)),
    [records, selectedIds],
  );

  const validSelectedRecords = useMemo(
    () => selectedRecords.filter((record) => record.errors.length === 0),
    [selectedRecords],
  );

  const downloadUrl = useMemo(() => {
    if (!resultCsv) {
      return null;
    }
    return URL.createObjectURL(
      new Blob([resultCsv], { type: 'text/csv;charset=utf-8;' }),
    );
  }, [resultCsv]);

  useEffect(() => {
    return () => {
      if (downloadUrl) {
        URL.revokeObjectURL(downloadUrl);
      }
    };
  }, [downloadUrl]);

  const fetchStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/amazon-entry', {
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error('status fetch failed');
      }
      const data = (await response.json()) as ApiState;
      setStatus(data.status);
      setProgress(data.progress ?? { total: 0, processed: 0 });
      setResults(data.results ?? []);
      setResultCsv(data.resultCsv ?? null);
      setErrorMessage(data.error ?? null);
      setCurrentProductId(data.currentProductId);
    } catch (error) {
      console.error(error);
      setErrorMessage('ステータスの取得に失敗しました。');
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    if (status !== 'running') {
      return undefined;
    }

    const interval = setInterval(() => {
      fetchStatus();
    }, 3000);

    return () => clearInterval(interval);
  }, [status, fetchStatus]);

  const handleFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) {
        return;
      }

      try {
        const text = await file.text();
        const parsed = buildParsedRecords(text);
        setRecords(parsed);
        setSelectedIds(
          new Set(parsed.filter((record) => record.errors.length === 0).map((record) => record.id)),
        );
        setErrorMessage(null);
        setResults([]);
        setResultCsv(null);
      } catch (error) {
        console.error(error);
        setErrorMessage('CSV の解析に失敗しました。フォーマットを確認してください。');
      } finally {
        event.target.value = '';
      }
    },
    [],
  );

  const handleFileButtonClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      const validIds = records
        .filter((record) => record.errors.length === 0)
        .map((record) => record.id);
      const allSelected = validIds.every((id) => prev.has(id));
      return new Set(allSelected ? [] : validIds);
    });
  }, [records]);

  const handleRun = useCallback(async () => {
    if (status === 'running') {
      return;
    }
    if (validSelectedRecords.length === 0) {
      setErrorMessage('有効なレコードを1件以上選択してください。');
      return;
    }

    setErrorMessage(null);
    setResultCsv(null);

    try {
      const payload: PostAmazonEntryRequest = {
        EntryItems: validSelectedRecords.map<EntryItem>((record) => ({
          JANCode: record.productId,
          price: Number(normalizeNumericString(record.price)),
          stock: Number(normalizeNumericString(record.stock)),
        })),
        isHeadless: !showBrowser,
        accountName,
      };
      const response = await fetch('/api/amazon-entry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        setErrorMessage(data.error ?? '実行リクエストに失敗しました。');
        await fetchStatus();
        return;
      }

      await fetchStatus();
    } catch (error) {
      console.error(error);
      setErrorMessage('実行リクエストに失敗しました。');
    }
  }, [
    status,
    validSelectedRecords,
    showBrowser,
    accountName,
    fetchStatus,
  ]);

  const handleForceStop = useCallback(async () => {
    try {
      const response = await fetch('/api/amazon-entry', { method: 'DELETE' });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        setErrorMessage(data.error ?? '強制停止に失敗しました。');
      }
      await fetchStatus();
    } catch (error) {
      console.error(error);
      setErrorMessage('強制停止リクエストに失敗しました。');
    }
  }, [fetchStatus]);

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 p-6">
      <header className="rounded-lg bg-zinc-900 p-6 text-white">
        <h1 className="text-2xl font-semibold">Amazon 商品エントリー管理</h1>
        <p className="mt-2 text-sm text-zinc-300">
          sample.csv と同じ形式でインポートし、検証済みレコードのみ実行できます。
        </p>
      </header>

      <section className="rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold">1. CSV インポート</h2>
        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleFileChange}
            className="hidden"
            aria-hidden="true"
            tabIndex={-1}
          />
          <button
            type="button"
            onClick={handleFileButtonClick}
            className="rounded border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-50"
          >
            CSVファイルを選択
          </button>
          <button
            type="button"
            onClick={toggleSelectAll}
            className="rounded border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50"
            disabled={records.length === 0}
          >
            {records.length === 0 ? 'データ未インポート' : '全レコード切り替え'}
          </button>
        </div>
        {errorMessage && (
          <p className="mt-4 rounded bg-red-50 p-3 text-sm text-red-700">
            {errorMessage}
          </p>
        )}
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold">2. データ確認 &amp; 検証</h2>
        {records.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-500">CSV をインポートするとここに表示されます。</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
                  <th className="p-2">選択</th>
                  <th className="p-2">JAN</th>
                  <th className="p-2">price</th>
                  <th className="p-2">stock</th>
                  <th className="p-2">データ整合性チェック</th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => (
                  <tr
                    key={record.id}
                    className="border-b last:border-0 hover:bg-zinc-50"
                  >
                    <td className="p-2">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(record.id)}
                        onChange={() => toggleSelect(record.id)}
                        disabled={record.errors.length > 0}
                      />
                    </td>
                    <td className="p-2 font-mono text-xs">{record.productId || '-'}</td>
                    <td className="p-2">{record.price || '-'}</td>
                    <td className="p-2">{record.stock || '-'}</td>
                    <td className="p-2">
                      {record.errors.length === 0 ? (
                        <span className="rounded bg-emerald-50 px-2 py-1 text-xs text-emerald-700">
                          OK
                        </span>
                      ) : (
                        <ul className="list-disc px-4 text-xs text-red-600">
                          {record.errors.map((error) => (
                            <li key={error}>{error}</li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold">3. 出品実行設定</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">使用アカウント</span>
            <select
              value={accountName}
              onChange={(event) => setAccountName(event.target.value as AccountName)}
              className="rounded border border-zinc-300 px-3 py-2"
            >
              {ACCOUNT_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={showBrowser}
              onChange={(event) => setShowBrowser(event.target.checked)}
              className="h-4 w-4"
            />
            <span>実行画面を表示</span>
          </label>
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={handleRun}
            disabled={status === 'running' || validSelectedRecords.length === 0}
            className="rounded bg-blue-600 px-6 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-blue-300"
          >
            出品を開始
          </button>
          <button
            type="button"
            onClick={handleForceStop}
            disabled={status !== 'running'}
            className="rounded border border-red-500 px-6 py-2 text-sm font-semibold text-red-600 disabled:cursor-not-allowed disabled:border-red-200 disabled:text-red-300"
          >
            強制終了
          </button>
          <div className="text-sm text-zinc-600">
            選択中: {validSelectedRecords.length} 件 / インポート: {records.length} 件
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold">4. 実行状況</h2>
        <div className="mt-4 flex flex-col gap-2 text-sm">
          <p>
            ステータス: <span className="font-semibold">{STATUS_LABEL[status]}</span>
          </p>
          <p>
            進捗: {progress.processed} / {progress.total}
          </p>
          <progress
            className="h-2 w-full"
            max={progress.total || 1}
            value={progress.processed}
          />
          {currentProductId && status === 'running' && (
            <p className="text-xs text-zinc-500">処理中: {currentProductId}</p>
          )}
        </div>
        {results.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
                  <th className="p-2">JAN</th>
                  <th className="p-2">ステータス</th>
                  <th className="p-2">エラー種別</th>
                  <th className="p-2">メッセージ</th>
                </tr>
              </thead>
              <tbody>
                {results.map((result) => (
                  <tr
                    key={`${result.JANCode}-${result.success}-${result.errorType ?? 'ok'}`}
                    className="border-b last:border-0"
                  >
                    <td className="p-2 font-mono text-xs">{result.JANCode}</td>
                    <td className="p-2">{result.success ? '成功' : '失敗'}</td>
                    <td className="p-2">{result.errorType ?? '-'}</td>
                    <td className="p-2 text-xs text-zinc-600">
                      {result.errorMessage ?? (result.success ? '出品が完了しました。' : '-')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {resultCsv && downloadUrl && (
          <a
            href={downloadUrl}
            download={`amazon-entry-result-${Date.now()}.csv`}
            className="mt-4 inline-flex w-fit items-center gap-2 rounded border border-zinc-300 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
          >
            結果CSVをダウンロード
          </a>
        )}
      </section>
    </div>
  );
}

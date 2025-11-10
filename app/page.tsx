'use client';

import type { ChangeEvent, MouseEvent, JSX } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parse } from 'csv-parse/browser/esm/sync';
import {
  ACCOUNT_NAME,
  type AccountName,
  type EntryItem,
  type EntryResult,
  type ErrorType,
} from '@/app/types';
import type { PostAmazonEntryRequest } from '@/app/dto';
import { getErrorTypeDescription } from '@/app/constants/errorTypeDescription';

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

const STATUS_BADGE_CLASS: Record<RunStatus, string> = {
  idle: 'bg-zinc-50 text-zinc-700 ring-1 ring-zinc-100',
  running: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100',
  completed: 'bg-blue-50 text-blue-700 ring-1 ring-blue-100',
  error: 'bg-red-50 text-red-700 ring-1 ring-red-100',
  aborted: 'bg-amber-50 text-amber-800 ring-1 ring-amber-100',
};

const SECTION_CARD_CLASS =
  'rounded-2xl border border-white/60 bg-white/95 p-6 shadow-xl shadow-slate-200/70 backdrop-blur';

const JAN_PATTERN = /^\d{13}$/;

const SAMPLE_IMPORT_CSV = `JAN,price,stock
4549957721409,11800,5
4549957722512,9800,3
4974019907609,5980,12
4580053450012,7800,8
4984824921234,4500,20`;

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
  const [errorModalMessage, setErrorModalMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const invalidRecordCount = useMemo(
    () => records.filter((record) => record.errors.length > 0).length,
    [records],
  );

  const { successCount, failureCount } = useMemo(() => {
    return results.reduce(
      (acc, result) => {
        if (result.success) {
          acc.successCount += 1;
        } else {
          acc.failureCount += 1;
        }
        return acc;
      },
      { successCount: 0, failureCount: 0 },
    );
  }, [results]);

  const progressRate = useMemo(() => {
    if (!progress.total || progress.total === 0) {
      return 0;
    }
    return Math.min(
      100,
      Math.round((progress.processed / progress.total) * 100),
    );
  }, [progress]);

  const selectedRecords = useMemo(
    () => records.filter((record) => selectedIds.has(record.id)),
    [records, selectedIds],
  );

  const validSelectedRecords = useMemo(
    () => selectedRecords.filter((record) => record.errors.length === 0),
    [selectedRecords],
  );

  const highlightCards = [
    {
      label: 'インポート済み',
      value: `${records.length}件`,
      description:
        invalidRecordCount > 0
          ? `要修正 ${invalidRecordCount} 件`
          : 'すべて整合性クリア',
    },
    {
      label: '検証済みで選択',
      value: `${validSelectedRecords.length}件`,
      description: `選択率 ${
        records.length === 0
          ? 0
          : Math.round((validSelectedRecords.length / records.length) * 100)
      }%`,
    },
    {
      label: '実行結果',
      value: results.length > 0 ? `${successCount} 成功` : '未実行',
      description:
        results.length > 0 ? `${failureCount} 件で対応が必要` : 'CSV 実行後に反映',
    },
    {
      label: '結果 CSV',
      value: resultCsv ? 'ダウンロード可' : '未生成',
      description: resultCsv ? '最新のレポートが利用できます' : '実行完了後に作成',
    },
  ];

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
          new Set(
            parsed
              .filter((record) => record.errors.length === 0)
              .map((record) => record.id),
          ),
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

  const handleDownloadSampleCsv = useCallback(() => {
    const blob = new Blob([SAMPLE_IMPORT_CSV], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'sample-import.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, []);

  const handleErrorTypeClick = useCallback(
    (type?: ErrorType, event?: MouseEvent<HTMLButtonElement>) => {
      if (!type) {
        return;
      }
      event?.preventDefault();
      event?.stopPropagation();
      setErrorModalMessage(getErrorTypeDescription(type));
    },
    [],
  );

  useEffect(() => {
    if (!errorModalMessage) {
      return undefined;
    }
    const handleEsc = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setErrorModalMessage(null);
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => {
      window.removeEventListener('keydown', handleEsc);
    };
  }, [errorModalMessage]);

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
        isHeadless: false,
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
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-blue-50">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6 lg:px-8">
        <header className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-blue-900 to-indigo-900 p-8 text-white shadow-2xl">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.25),_transparent)]" />
          <div className="relative z-10 flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-1 text-sm text-white/80">
                <span
                  className={`h-2 w-2 rounded-full ${
                    status === 'running' ? 'bg-emerald-300 animate-pulse' : 'bg-white/70'
                  }`}
                />
                <span>{STATUS_LABEL[status]}</span>
              </div>
              <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                Amazon商品エントリーし太郎
              </h1>
              <p className="max-w-2xl text-sm text-white/80 sm:text-base">
                Amazonの相乗り出品の自動化ツール
              </p>
              <div className="flex flex-wrap gap-3 text-sm">
                <button
                  type="button"
                  onClick={handleFileButtonClick}
                  className="inline-flex items-center gap-2 rounded-full bg-white/90 px-5 py-2 font-semibold text-slate-900 shadow-lg shadow-slate-900/20 transition hover:-translate-y-0.5"
                >
                  CSV をインポート
                </button>
                <button
                  type="button"
                  onClick={handleDownloadSampleCsv}
                  className="inline-flex items-center gap-2 rounded-full border border-white/50 px-5 py-2 font-semibold text-white/90 transition hover:bg-white/10"
                >
                  サンプルCSV
                </button>
              </div>
            </div>
            <div className="rounded-2xl border border-white/30 bg-white/10 p-6 text-sm text-white/80 shadow-2xl backdrop-blur">
              <p className="text-xs uppercase tracking-[0.3em] text-white/70">Progress</p>
              <p className="mt-3 text-4xl font-semibold text-white">{progressRate}%</p>
              <p className="text-xs text-white/80">
                進捗 {progress.processed} / {progress.total || 0}
              </p>
              {currentProductId && status === 'running' && (
                <p className="mt-2 text-xs text-white/70">処理中: {currentProductId}</p>
              )}
              <div className="mt-4 h-2 w-full rounded-full bg-white/20">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-emerald-300 to-sky-400"
                  style={{ width: `${progressRate}%` }}
                />
              </div>
            </div>
          </div>
          <div className="relative z-10 mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {highlightCards.map((card) => (
              <div
                key={card.label}
                className="rounded-2xl border border-white/20 bg-white/10 p-5 text-sm shadow-lg backdrop-blur"
              >
                <p className="text-white/70">{card.label}</p>
                <p className="mt-2 text-2xl font-semibold text-white">{card.value}</p>
                <p className="mt-1 text-xs text-white/70">{card.description}</p>
              </div>
            ))}
          </div>
        </header>

        <section className={SECTION_CARD_CLASS}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-blue-500">Step 1</p>
              <h2 className="text-lg font-semibold text-zinc-900">CSV インポート</h2>
              <p className="mt-1 text-sm text-zinc-500">
                sample.csv と同形式の CSV をアップロードし、整合性チェックを実行します。
              </p>
            </div>
            <div className="text-sm text-zinc-500">
              {records.length === 0 ? '未インポート' : `合計 ${records.length} 件`}
            </div>
          </div>
          <div className="mt-6 flex flex-col gap-4 lg:flex-row">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              className="hidden"
              aria-hidden="true"
              tabIndex={-1}
            />
            <div className="flex flex-1 flex-wrap gap-3">
              <button
                type="button"
                onClick={handleFileButtonClick}
                className="inline-flex flex-1 items-center justify-center rounded-xl bg-gradient-to-r from-blue-600 to-indigo-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-500/30 transition hover:translate-y-0.5 sm:flex-none sm:px-6"
              >
                CSVファイルを選択
              </button>
              <button
                type="button"
                onClick={handleDownloadSampleCsv}
                className="inline-flex flex-1 items-center justify-center rounded-xl border border-dashed border-blue-300 px-4 py-3 text-sm font-semibold text-blue-600 hover:bg-blue-50 sm:flex-none sm:px-6"
              >
                サンプルCSVを確認
              </button>
              <button
                type="button"
                onClick={toggleSelectAll}
                className="inline-flex flex-1 items-center justify-center rounded-xl border border-zinc-200 px-4 py-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50 sm:flex-none sm:px-6"
                disabled={records.length === 0}
              >
                {records.length === 0 ? 'データ未インポート' : '全レコード切り替え'}
              </button>
            </div>
          </div>
          {errorMessage && (
            <p className="mt-4 rounded-2xl border border-red-200 bg-red-50/70 p-4 text-sm text-red-700">
              {errorMessage}
            </p>
          )}
        </section>

        <section className={SECTION_CARD_CLASS}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-blue-500">Step 2</p>
              <h2 className="text-lg font-semibold text-zinc-900">データ確認 &amp; 検証</h2>
              <p className="mt-1 text-sm text-zinc-500">
                エラーのある行は自動的に除外されるため、内容を修正して再インポートしてください。
              </p>
            </div>
            <span className="text-sm text-zinc-500">
              有効 {records.length - invalidRecordCount} 件 / エラー {invalidRecordCount} 件
            </span>
          </div>
          {records.length === 0 ? (
            <div className="mt-6 rounded-2xl border border-dashed border-zinc-200 bg-zinc-50/70 p-8 text-center text-sm text-zinc-500">
              CSV をインポートするとテーブルにデータが表示されます。
            </div>
          ) : (
            <div className="mt-6 overflow-x-auto rounded-2xl border border-zinc-100">
              <table className="min-w-full divide-y divide-zinc-100 text-left text-sm">
                <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="p-3">選択</th>
                    <th className="p-3">JAN</th>
                    <th className="p-3">price</th>
                    <th className="p-3">stock</th>
                    <th className="p-3">データ整合性チェック</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 bg-white">
                  {records.map((record) => (
                    <tr key={record.id} className="hover:bg-zinc-50/70">
                      <td className="p-3">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(record.id)}
                          onChange={() => toggleSelect(record.id)}
                          disabled={record.errors.length > 0}
                        />
                      </td>
                      <td className="p-3 font-mono text-xs">{record.productId || '-'}</td>
                      <td className="p-3">{record.price || '-'}</td>
                      <td className="p-3">{record.stock || '-'}</td>
                      <td className="p-3">
                        {record.errors.length === 0 ? (
                          <span className="inline-flex items-center rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                            OK
                          </span>
                        ) : (
                          <ul className="list-disc space-y-1 px-4 text-xs text-red-600">
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

        <section className={SECTION_CARD_CLASS}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-blue-500">Step 3</p>
              <h2 className="text-lg font-semibold text-zinc-900">出品実行設定</h2>
              <p className="mt-1 text-sm text-zinc-500">
                実行アカウントを選択し、実行。
              </p>
            </div>
            <span className="text-sm text-zinc-500">
              選択中 {validSelectedRecords.length} 件 / インポート {records.length} 件
            </span>
          </div>
          <div className="mt-6 grid gap-4">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-zinc-800">使用アカウント</span>
              <select
                value={accountName}
                onChange={(event) => setAccountName(event.target.value as AccountName)}
                className="rounded-xl border border-zinc-200 px-3 py-2 shadow-inner focus:border-blue-500 focus:outline-none"
              >
                {ACCOUNT_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleRun}
              disabled={status === 'running' || validSelectedRecords.length === 0}
              className="inline-flex items-center justify-center rounded-full bg-gradient-to-r from-blue-600 to-indigo-500 px-6 py-2 text-sm font-semibold text-white shadow-lg shadow-blue-500/30 transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:from-blue-200 disabled:to-indigo-200"
            >
              出品を開始
            </button>
            <button
              type="button"
              onClick={handleForceStop}
              disabled={status !== 'running'}
              className="inline-flex items-center justify-center rounded-full border border-red-400 px-6 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:border-red-200 disabled:text-red-300"
            >
              強制終了
            </button>
            <div className="inline-flex items-center rounded-full border border-dashed border-zinc-300 px-4 py-2 text-xs text-zinc-500">
              実行準備が整ったレコードのみ送信されます
            </div>
          </div>
        </section>

        <section className={SECTION_CARD_CLASS}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-blue-500">Step 4</p>
              <h2 className="text-lg font-semibold text-zinc-900">実行状況</h2>
            </div>
            <span
              className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${STATUS_BADGE_CLASS[status]}`}
            >
              {STATUS_LABEL[status]}
            </span>
          </div>
          <div className="mt-6 space-y-3 text-sm text-zinc-600">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p>
                進捗: {progress.processed} / {progress.total}
              </p>
              {currentProductId && status === 'running' && (
                <p className="text-xs text-zinc-500">処理中: {currentProductId}</p>
              )}
            </div>
            <div className="h-2 w-full rounded-full bg-zinc-100">
              <div
                className="h-full rounded-full bg-gradient-to-r from-blue-500 via-indigo-500 to-emerald-400 transition-all"
                style={{ width: `${progressRate}%` }}
              />
            </div>
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <div className="rounded-xl border border-zinc-100 bg-zinc-50/70 p-4">
              <p className="text-xs text-zinc-500">成功</p>
              <p className="text-2xl font-semibold text-emerald-600">{successCount}</p>
            </div>
            <div className="rounded-xl border border-zinc-100 bg-zinc-50/70 p-4">
              <p className="text-xs text-zinc-500">要確認</p>
              <p className="text-2xl font-semibold text-red-500">{failureCount}</p>
            </div>
            <div className="rounded-xl border border-zinc-100 bg-zinc-50/70 p-4">
              <p className="text-xs text-zinc-500">結果 CSV</p>
              <p className="text-2xl font-semibold text-blue-600">{resultCsv ? '準備OK' : '未生成'}</p>
            </div>
          </div>
          {results.length > 0 ? (
            <div className="mt-6 overflow-x-auto rounded-2xl border border-zinc-100">
              <table className="min-w-full divide-y divide-zinc-100 text-left text-sm">
                <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="p-3">JAN</th>
                    <th className="p-3">ステータス</th>
                    <th className="p-3">エラー種別</th>
                    <th className="p-3">メッセージ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 bg-white">
                  {results.map((result) => (
                    <tr
                      key={`${result.JANCode}-${result.success}-${result.errorType ?? 'ok'}`}
                      className="hover:bg-zinc-50/70"
                    >
                      <td className="p-3 font-mono text-xs">{result.JANCode}</td>
                      <td className="p-3">
                        <span
                          className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
                            result.success
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-red-50 text-red-600'
                          }`}
                        >
                          {result.success ? '成功' : '失敗'}
                        </span>
                      </td>
                      <td className="p-3">
                        {result.errorType ? (
                          <button
                            type="button"
                            className="text-blue-600 underline underline-offset-2"
                            onClick={(event) => handleErrorTypeClick(result.errorType, event)}
                          >
                            {result.errorType}
                          </button>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className="p-3 text-xs text-zinc-600">
                        {result.errorMessage ?? (result.success ? '出品が完了しました。' : '-')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="mt-6 rounded-2xl border border-dashed border-zinc-200 bg-zinc-50/70 p-8 text-center text-sm text-zinc-500">
              実行履歴がまだありません。出品を開始するとここに結果が表示されます。
            </div>
          )}
          {resultCsv && downloadUrl && (
            <a
              href={downloadUrl}
              download={`amazon-entry-result-${Date.now()}.csv`}
              className="mt-6 inline-flex w-fit items-center gap-2 rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-slate-900/30 transition hover:-translate-y-0.5"
            >
              結果CSVをダウンロード
            </a>
          )}
        </section>

        {errorModalMessage && (
          <div className="fixed inset-0 z-40 flex items-center justify-center">
            <button
              type="button"
              aria-label="エラー詳細を閉じる"
              className="absolute inset-0 h-full w-full bg-black/50 backdrop-blur-sm"
              onClick={() => setErrorModalMessage(null)}
            />
            <div
              role="dialog"
              aria-modal="true"
              className="relative z-50 w-full max-w-md rounded-2xl border border-white/40 bg-white/95 p-6 text-sm text-zinc-700 shadow-2xl"
            >
              <h3 className="text-base font-semibold text-zinc-900">エラー詳細</h3>
              <p className="mt-3 text-sm text-zinc-700">{errorModalMessage}</p>
              <div className="mt-6 flex justify-end">
                <button
                  type="button"
                  onClick={() => setErrorModalMessage(null)}
                  className="rounded-full bg-gradient-to-r from-blue-600 to-indigo-500 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-blue-500/30"
                >
                  閉じる
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

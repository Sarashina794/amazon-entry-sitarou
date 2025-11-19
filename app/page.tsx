import type { JSX } from 'react';
import Link from 'next/link';

const ENTRY_OPTIONS = [
  {
    href: '/jan-entry',
    title: 'JAN で商品エントリー',
    description: 'JAN コードを使って商品検索と登録を行います。',
    badge: 'JAN モード',
  },
  {
    href: '/asin-entry',
    title: 'ASIN で商品エントリー',
    description: 'ASIN で検索し SKU を登録するユースケースに対応します。',
    badge: 'ASIN / SKU モード',
  },
];

export default function HomePage(): JSX.Element {
  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-blue-50">
      <div className="mx-auto flex max-w-4xl flex-col gap-8 px-4 py-16 sm:px-6 lg:px-8">
        <header className="rounded-3xl bg-gradient-to-br from-slate-900 via-blue-900 to-indigo-900 p-10 text-white shadow-2xl">
          <p className="text-sm uppercase tracking-[0.4em] text-white/70">Amazon Entry</p>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
            Amazon商品エントリーし太郎
          </h1>
          <p className="mt-4 max-w-2xl text-sm text-white/80 sm:text-base">
            利用したいワークフローを選択してください。JAN と ASIN / SKU の 2 つのモードを提供しています。
          </p>
        </header>
        <section className="grid gap-6 md:grid-cols-2">
          {ENTRY_OPTIONS.map((option) => (
            <Link
              key={option.href}
              href={option.href}
              className="group rounded-2xl border border-zinc-100 bg-white/90 p-6 shadow-xl shadow-slate-200/50 transition hover:-translate-y-1 hover:border-blue-200 hover:shadow-blue-200/70"
            >
              <span className="inline-flex items-center rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-600">
                {option.badge}
              </span>
              <h2 className="mt-3 text-xl font-semibold text-zinc-900">{option.title}</h2>
              <p className="mt-2 text-sm text-zinc-600">{option.description}</p>
              <span className="mt-6 inline-flex items-center text-sm font-semibold text-blue-600">
                ページへ進む
                <svg
                  className="ml-2 h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M5 12h14m0 0-6-6m6 6-6 6"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
            </Link>
          ))}
        </section>
      </div>
    </main>
  );
}

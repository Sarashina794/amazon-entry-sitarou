"use client";

import { EntryPage } from '@/app/features/entry/createEntryPage';
import { ASIN_ENTRY_CONFIG } from '@/app/features/entry/config';

export default function AsinEntryPage(): JSX.Element {
  return <EntryPage config={ASIN_ENTRY_CONFIG} />;
}

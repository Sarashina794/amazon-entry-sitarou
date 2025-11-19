"use client";

import { EntryPage } from '@/app/features/entry/createEntryPage';
import { JAN_ENTRY_CONFIG } from '@/app/features/entry/config';

export default function JanEntryPage(): JSX.Element {
  return <EntryPage config={JAN_ENTRY_CONFIG} />;
}

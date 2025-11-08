import type { EntryResult, EntryItem, AccountName } from '../types';

export type PostAmazonEntryRequest = {
  accountName: AccountName;
  isHeadless: boolean;
  EntryItems: EntryItem[];
};

export type PostAmazonEntryResponse = EntryResult[];

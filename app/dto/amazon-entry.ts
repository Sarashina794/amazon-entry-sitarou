import type { EntryResult, EntryItem, AccountName } from '../types';

export type PostAmazonEntryRequest = {
  accountName: AccountName;
  isHeadless: boolean;
  EntryItems: EntryItem[];
  identifierLabel?: string;
  searchType?: 'JAN' | 'ASIN';
};

export type PostAmazonEntryResponse = EntryResult[];

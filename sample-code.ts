import {
  chromium,
  Browser,
  BrowserContext,
  Page,
  errors,
} from 'playwright';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { authenticator } from 'otplib';
import { parse } from 'csv-parse/sync';

const STORAGE_STATE_PATH = process.env.STORAGE_STATE_PATH ?? 'state.json';
const SHOULD_PERSIST_STATE = process.env.PERSIST_STORAGE_STATE !== 'false';
// const ACCOUNT_NAME = process.env.ACCOUNT_NAME ?? 'FIVES WORKWEAR';
const ACCOUNT_NAME = process.env.ACCOUNT_NAME ?? 'ワークウェアショップ KeyPoint';
const REGION_NAME = process.env.REGION_NAME ?? '日本';
const PRODUCT_IDENTIFIER =
  process.env.PRODUCT_IDENTIFIER ?? '4571648673605'; //JAN
const INVENTORY_COUNT = process.env.INVENTORY_COUNT ?? '0';
const PRODUCT_PRICE = process.env.PRODUCT_PRICE ?? '6890';
const LISTING_CSV_PATH = process.env.LISTING_CSV_PATH ?? 'new-entry-list.csv';
const RESULT_CSV_PATH = process.env.RESULT_CSV_PATH ?? 'result.csv';
const DEFAULT_LISTING_TIMEOUT_MS = 50_00;
const LISTING_PROCESS_TIMEOUT_MS = (() => {
  const parsed = Number.parseInt(
    process.env.LISTING_PROCESS_TIMEOUT_MS ?? '',
    10,
  );
  return Number.isNaN(parsed) ? DEFAULT_LISTING_TIMEOUT_MS : parsed;
})();
const HEADLESS =
  process.env.HEADLESS != null
    ? process.env.HEADLESS !== 'false'
    : false;
const SLOW_MO = process.env.SLOW_MO
  ? Number.parseInt(process.env.SLOW_MO, 10)
  : undefined;
const SIGN_IN_EMAIL =
  process.env.AMAZON_EMAIL ?? process.env.LOGIN_EMAIL ?? "moritaka.agroworks@gmail.com";
const SIGN_IN_PASSWORD =
  process.env.AMAZON_PASSWORD ?? process.env.LOGIN_PASSWORD ?? "Asumi_1201";
const SIGN_IN_OTP_SECRET =
  process.env.AMAZON_OTP_SECRET ??
  process.env.OTP_SECRET ??
  process.env.AUTHENTICATOR_SECRET ??
  "DJOT4ZWJ6O4ZUJQVIFHOCVKICTKJ5VTGLPY5IRXNVSFUV4KCGFOQ";
const MAX_OTP_ATTEMPTS = 3;

const SIGN_IN_URL =
  'https://sellercentral-japan.amazon.com/ap/signin?openid.pape.max_auth_age=0&openid.return_to=https%3A%2F%2Fsellercentral-japan.amazon.com%2Fproduct-search%3Fref%3Dxx_catadd_dnav_xx&openid.identity=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.assoc_handle=sc_jp_amazon_com_v2&openid.mode=checkid_setup&language=ja_JP&openid.claimed_id=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&pageId=sc_amazon_v3_unified&openid.ns=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0&ssoResponse=eyJ6aXAiOiJERUYiLCJlbmMiOiJBMjU2R0NNIiwiYWxnIjoiQTI1NktXIn0.3152N7ZUUagOyopFtZ4LcJxdTpS7weHTCvE1EUsE7yatcMIwMn6w8g.pFOfbP0LqqhgGqUJ.S-bStnhvLnfEzi94Fk4gP41IZg4ViEanu-d0pn-t2iOeh-_pT8liZMTVjWQpchaFbe5B67dMuWPDCxhPOMdTH-LI5LLct7J0sDQS3Vgl1tBAPbfinRebXf5SL7VQ_w5FtDCIuS6XevH-jl-X8WLQjyMt40poU4bt_D4I-jQ1pF_0EycjymPrNGxX0g1tARsuA3prNeB3Rg.AK8IaQVjyWHwQhGYJzuXFA';
const PRODUCT_SEARCH_URL =
  'https://sellercentral-japan.amazon.com/product-search?ref=xx_catadd_dnav_xx';

const EMAIL_INPUT_NAME =
  '携帯電話番号またはEメールアドレスを入力します';
const PASSWORD_INPUT_NAME = 'パスワード';
const OTP_INPUT_NAME = 'コードを入力する:';

interface ListingTask {
  productId: string;
  price: string;
  stock: string;
}

type ListingResultStatus =
  | 'no_results'
  | 'brand_permission_required'
  | 'duplicate_sku'
  | 'timeout'
  | 'error'
  |'invalid_input';

interface ListingResult {
  productId: string;
  status: ListingResultStatus;
  message: string;
}

function isTimeoutError(error: unknown): boolean {
  if (error instanceof errors.TimeoutError) {
    return true;
  }

  if (error instanceof Error) {
    return error.name === 'TimeoutError';
  }

  return false;
}

async function ensureSignedIn(page: Page): Promise<void> {
  const emailInput = page
    .getByRole('textbox', { name: EMAIL_INPUT_NAME })
    .first();

  if ((await emailInput.count()) === 0) {
    return;
  }

  if (!SIGN_IN_EMAIL) {
    throw new Error(
      'AMAZON_EMAIL (or LOGIN_EMAIL) must be set to allow automated sign-in.',
    );
  }

  if (!SIGN_IN_PASSWORD) {
    throw new Error(
      'AMAZON_PASSWORD (or LOGIN_PASSWORD) must be set to allow automated sign-in.',
    );
  }

  await emailInput.waitFor({ state: 'visible' });
  await emailInput.fill(SIGN_IN_EMAIL);

  const nextButton = page.getByRole('button', { name: '次に進む' }).first();
  if ((await nextButton.count()) > 0) {
    await nextButton.click();
  }

  const passwordInput = page
    .getByRole('textbox', { name: PASSWORD_INPUT_NAME })
    .first();
  await passwordInput.waitFor({ state: 'visible' });
  await passwordInput.fill(SIGN_IN_PASSWORD);

  const loginButton = page.getByRole('button', { name: 'ログイン' }).first();
  if ((await loginButton.count()) === 0) {
    throw new Error(
      'Failed to locate the "ログイン" button on the password step.',
    );
  }

  await loginButton.click();
  await page.waitForLoadState('domcontentloaded');

  await handleOtpChallenge(page);
}

async function handleOtpChallenge(page: Page): Promise<void> {
  const otpFieldLocator = () =>
    page.getByRole('textbox', { name: OTP_INPUT_NAME }).first();

  if ((await otpFieldLocator().count()) === 0) {
    return;
  }

  if (!SIGN_IN_OTP_SECRET) {
    throw new Error(
      'AMAZON_OTP_SECRET (or OTP_SECRET/AUTHENTICATOR_SECRET) must be set to solve the OTP challenge automatically.',
    );
  }

  const signInButtonLocator = () =>
    page.getByRole('button', { name: 'サインイン' }).first();

  for (let attempt = 0; attempt < MAX_OTP_ATTEMPTS; attempt += 1) {
    const otpField = otpFieldLocator();
    await otpField.waitFor({ state: 'visible' });

    const token = authenticator.generate(SIGN_IN_OTP_SECRET);
    await otpField.fill('');
    await otpField.fill(token);

    const signInButton = signInButtonLocator();
    if ((await signInButton.count()) === 0) {
      throw new Error(
        'Failed to locate the "サインイン" button on the OTP challenge step.',
      );
    }

    await signInButton.click();
    await page.waitForLoadState('domcontentloaded');

    if ((await otpFieldLocator().count()) === 0) {
      return;
    }

    await page.waitForTimeout(1500);
  }

  if ((await otpFieldLocator().count()) !== 0) {
    throw new Error(
      'Unable to pass the OTP challenge automatically. Verify the authenticator secret.',
    );
  }
}

function stripQuotes(value?: string): string {
  return value ? value.replace(/(^"+|"+$)/g, '') : '';
}

function sanitizeNumericValue(
  value: string | undefined,
  fallback: string,
): string {
  if (!value) {
    return fallback;
  }

  const cleaned = value.replace(/"/g, '').replace(/,/g, '').trim();
  return cleaned.length > 0 ? cleaned : fallback;
}

function createFallbackTask(): ListingTask {
  return {
    productId: PRODUCT_IDENTIFIER,
    price: PRODUCT_PRICE,
    stock: INVENTORY_COUNT,
  };
}

function loadListingTasks(): ListingTask[] {
  if (!existsSync(LISTING_CSV_PATH)) {
    return [createFallbackTask()];
  }

  const raw = readFileSync(LISTING_CSV_PATH, 'utf8').trim();
  if (!raw) {
    return [createFallbackTask()];
  }

  let records: Record<string, string>[];
  try {
    records = parse(raw, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      delimiter: ['\t', ','],
      relax_column_count: true,
    }) as Record<string, string>[];
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('Failed to parse CSV file, falling back to env defaults.', error);
    return [createFallbackTask()];
  }

  const tasks: ListingTask[] = [];
  for (const record of records) {
    const normalized = Object.fromEntries(
      Object.entries(record).map(([key, value]) => [
        key.trim().toLowerCase(),
        typeof value === 'string' ? value.trim() : value,
      ]),
    );

    const productId = stripQuotes(
      (normalized.jan as string | undefined) ??
        (normalized.productid as string | undefined) ??
        '',
    );
    if (!productId) {
      continue;
    }

    tasks.push({
      productId,
      price: sanitizeNumericValue(
        normalized.price as string | undefined,
        PRODUCT_PRICE,
      ),
      stock: sanitizeNumericValue(
        normalized.stock as string | undefined,
        INVENTORY_COUNT,
      ),
    });
  }

  return tasks.length > 0 ? tasks : [createFallbackTask()];
}

function escapeCsvValue(value: string): string {
  const normalized = value ?? '';
  if (/[",\n]/.test(normalized)) {
    return `"${normalized.replace(/"/g, '""')}"`;
  }
  return normalized;
}

function writeListingResults(results: ListingResult[]): void {
  const header = 'productId,status,message\n';
  const body = results
    .map((result) =>
      [
        escapeCsvValue(result.productId),
        escapeCsvValue(result.status),
        escapeCsvValue(result.message),
      ].join(','),
    )
    .join('\n');
  writeFileSync(
    RESULT_CSV_PATH,
    body.length > 0 ? `${header}${body}\n` : header,
    'utf8',
  );
}

async function navigateToProductSearch(page: Page): Promise<void> {
  await page.goto(PRODUCT_SEARCH_URL, { waitUntil: 'domcontentloaded' });
}

async function selectAccountAndRegion(page: Page): Promise<void> {
  const accountButton = page.getByRole('button', { name: ACCOUNT_NAME });

    await accountButton.first().click();


  const regionButton = page.getByRole('button', { name: REGION_NAME });

    await regionButton.first().click();


  const selectAccountButton = page.getByRole('button', {
    name: 'アカウントを選択',
  });

    await selectAccountButton.first().click();

}

async function processListing(
  page: Page,
  listing: ListingTask,
): Promise<ListingResult | null> {
  await navigateToProductSearch(page);
  // await page.goto(PRODUCT_SEARCH_URL, { waitUntil: 'domcontentloaded' });
  const searchBox = page
    .getByRole('textbox', {
      name: '商品名、説明、キーワードを入力',
    })
    .first();
  await searchBox.waitFor({ state: 'visible' });
  await searchBox.click();
  await searchBox.fill(listing.productId);

  await page
    .getByTestId('omnibox-submit-button')
    .getByRole('button', { name: '検索' })
    .click();
  await page.waitForTimeout(1000);
// 検索クエリに一致する結果が見つかりません。のテキストがあったらスキップする => result.csvに記録する
  const noResultsLocator = page
      .getByText('検索クエリに一致する結果が見つかりません')
      .first();
  if (await noResultsLocator.count() > 0) {
    const message = '検索クエリに一致する結果が見つかりません。';
    console.log(`No results found for JAN: ${listing.productId}, skipping.`);
    return {
      productId: listing.productId,
      status: 'no_results',
      message,
    };
  }
  const expandIcon = page.getByText('').first();

    await expandIcon.waitFor({ state: 'visible' });
    await expandIcon.click();
// ページのDOM構築が終わるまで待つ
await page.waitForLoadState('domcontentloaded');

// ロード後にlocatorを取得
const brandRestrictionLocator = page
  .getByText('このブランドには出品許可が必要です。')
  .first();

// 文言が表示されるかを確認（最大3秒待つ）
let isBrandRestricted = false;
try {
  await brandRestrictionLocator.waitFor({ state: 'visible', timeout: 3000 });
  isBrandRestricted = true;
} catch {
  // 表示されなかった → ブランド制限なし と判断
}

if (isBrandRestricted) {
  const message = 'このブランドには出品許可が必要です。';
  console.log(
    `Brand permission required for JAN: ${listing.productId}, skipping.`,
  );
  return {
    productId: listing.productId,
    status: 'brand_permission_required',
    message,
  };
}

  const secondaryToggle = page.locator('#katal-id-6').first();

    await secondaryToggle.waitFor({ state: 'visible' });
    await secondaryToggle.click();


  const listingCard = page.locator('.standard-option-content').first();
  await listingCard.waitFor({ state: 'visible' });
  await listingCard.click();
  console.log('Listing page opened');
  // await page.waitForTimeout(5000);
  const listingPagePromise = page.waitForEvent('popup');


  
    await page.getByRole('button', { name: 'この商品を出品する' }).click();
  const listingPage = await listingPagePromise;
  await listingPage.waitForLoadState('domcontentloaded');

  const skuBox = listingPage.getByRole('textbox', { name: 'SKU' });
  await skuBox.click();
  await skuBox.fill(listing.productId);

    console.log('Fulfilling by Merchant selected');

    // ここから商品情報の入力
    await listingPage.locator('kat-box').filter({ hasText: '私はこの商品を自分で発送します 私はこの商品を自分で発送します （出品者出荷） （出品者出荷）' }).click();
    console.log('Shipping method set to Merchant Fulfilled');
  const inventoryInput = listingPage.getByRole('spinbutton', {
    name: '在庫数',
  });
  await inventoryInput.fill(listing.stock);

  const priceInput = listingPage.getByRole('textbox', {
    name: '商品の販売価格',
  });
  await priceInput.fill(listing.price);
    console.log('Filled listing form fields');
  // await page.waitForTimeout(10000);

  await listingPage.locator('div').filter({ hasText: /^送信$/ }).click();

  // もしこのボタンが出てこない場合は入力に誤りがあるのでreturnで抜ける
// 「商品の登録」ボタンの取得
const registerButton = listingPage
  .getByRole('button', {
    name: '商品の登録',
  })
  .first();

let hasRegisterButton = true;
try {
  // 最大3秒待ってボタンが表示されるか確認
  await registerButton.waitFor({ state: 'visible', timeout: 3000 });
} catch {
  hasRegisterButton = false;
}

if (!hasRegisterButton) {
  console.log(
    `No '商品の登録' button found for JAN: ${listing.productId}. Possibly invalid input. Skipping.`
  );
  return {
    productId: listing.productId,
    status: 'invalid_input',
    message: '商品の登録ボタンが表示されませんでした。',
  };
}

  try {
    await Promise.all([
      listingPage.waitForLoadState('domcontentloaded'),
      registerButton.click(),
    ]);

    await listingPage.waitForTimeout(1000);

    return null;
  } finally {
    await listingPage.close();
    await page.waitForTimeout(2000);
  }
}

async function run(): Promise<void> {
  const listingResults: ListingResult[] = [];
  const browser: Browser = await chromium.launch({
    headless: HEADLESS,
    slowMo: Number.isNaN(SLOW_MO) ? undefined : SLOW_MO,
  });

  let context: BrowserContext | undefined;
  try {
    context = await browser.newContext(
      undefined,
    );

    context.setDefaultTimeout(LISTING_PROCESS_TIMEOUT_MS);
    context.setDefaultNavigationTimeout(LISTING_PROCESS_TIMEOUT_MS);

    const page: Page = await context.newPage();
    await page.goto(SIGN_IN_URL, { waitUntil: 'domcontentloaded' });
    await ensureSignedIn(page);

    const listings = loadListingTasks();
    // await navigateToProductSearch(page);
    await selectAccountAndRegion(page);
    const timedOutListings: string[] = [];
    for (const listing of listings) {
      // eslint-disable-next-line no-console
      console.log(`Processing JAN: ${listing.productId}`);
      try {
        const result = await processListing(page, listing);
        if (result) {
          listingResults.push(result);
        }
      } catch (error) {
        if (isTimeoutError(error)) {
          // eslint-disable-next-line no-console
          console.warn(
            `Processing timed out for JAN: ${listing.productId}`,
            error,
          );
          timedOutListings.push(listing.productId);
          listingResults.push({
            productId: listing.productId,
            status: 'timeout',
            message: 'Processing timed out before completion.',
          });
          continue;
        }
        listingResults.push({
          productId: listing.productId,
          status: 'error',
          message:
            error instanceof Error ? error.message : 'Unknown processing error.',
        });
        throw error;
      }
    }

    if (timedOutListings.length > 0) {
      // eslint-disable-next-line no-console
      console.log('Timed out JAN(s):', timedOutListings.join(', '));
    }

    // if (context && SHOULD_PERSIST_STATE) {
    //   await context.storageState({ path: STORAGE_STATE_PATH });
    // }
  } finally {
    try {
      if (context) {
        await context.close();
      }
      await browser.close();
    } finally {
      writeListingResults(listingResults);
    }
  }
}

if (require.main === module) {
  run().catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exitCode = 1;
  });
}

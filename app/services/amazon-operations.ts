import {
  chromium,
  Browser,
  BrowserContext,
  Page,
  errors,
} from 'playwright';
import { authenticator } from 'otplib';
import {
  ACCOUNT_NAME,
  type AccountName,
  ERROR_TYPE,
  type EntryItem,
  type EntryResult,
} from '../types';

const SIGN_IN_URL =
  'https://sellercentral-japan.amazon.com/ap/signin?openid.pape.max_auth_age=0&openid.return_to=https%3A%2F%2Fsellercentral-japan.amazon.com%2Fproduct-search%3Fref%3Dxx_catadd_dnav_xx&openid.identity=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.assoc_handle=sc_jp_amazon_com_v2&openid.mode=checkid_setup&language=ja_JP&openid.claimed_id=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&pageId=sc_amazon_v3_unified&openid.ns=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0&ssoResponse=eyJ6aXAiOiJERUYiLCJlbmMiOiJBMjU2R0NNIiwiYWxnIjoiQTI1NktXIn0.3152N7ZUUagOyopFtZ4LcJxdTpS7weHTCvE1EUsE7yatcMIwMn6w8g.pFOfbP0LqqhgGqUJ.S-bStnhvLnfEzi94Fk4gP41IZg4ViEanu-d0pn-t2iOeh-_pT8liZMTVjWQpchaFbe5B67dMuWPDCxhPOMdTH-LI5LLct7J0sDQS3Vgl1tBAPbfinRebXf5SL7VQ_w5FtDCIuS6XevH-jl-X8WLQjyMt40poU4bt_D4I-jQ1pF_0EycjymPrNGxX0g1tARsuA3prNeB3Rg.AK8IaQVjyWHwQhGYJzuXFA';
const PRODUCT_SEARCH_URL =
  'https://sellercentral-japan.amazon.com/product-search?ref=xx_catadd_dnav_xx';
const EMAIL_INPUT_NAME = '携帯電話番号またはEメールアドレスを入力します';
const PASSWORD_INPUT_NAME = 'パスワード';
const OTP_INPUT_NAME = 'コードを入力する:';
const REGION_NAME_DEFAULT = '日本';
const ACCOUNT_NAME_VALUES = Object.values(ACCOUNT_NAME) as AccountName[];

export interface BrowserLaunchOptions {
  headless?: boolean;
  timeoutMs?: number;
}

export interface LaunchedBrowser {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

export interface SignInOptions {
  page: Page;
  email: string;
  password: string;
  otpSecret: string;
  accountName: AccountName;
  regionName?: string;
}

export interface SearchProductResult {
  listingPage?: Page;
  error?: EntryResult;
}

/**
 * Playwright の TimeoutError を判定し、通信遅延か通常のエラーかを切り分けます。
 */
export const isTimeoutError = (error: unknown): boolean => {
  if (error instanceof errors.TimeoutError) {
    return true;
  }
  if (error instanceof Error) {
    return error.name === 'TimeoutError';
  }
  return false;
};

/**
 * リクエストで指定された出品アカウント名を検証し、未指定時は既定値を返します。
 */
export const ensureAccountName = (value?: AccountName): AccountName => {
  if (value && ACCOUNT_NAME_VALUES.includes(value)) {
    return value;
  }
  return ACCOUNT_NAME['ワークウェアショップ KeyPoint'];
};

/**
 * Playwright ブラウザ/コンテキスト/ページを起動し、設定済みの永続化関数と一緒に返します。
 */
export const launchAmazonBrowser = async (
  options: BrowserLaunchOptions = {},
): Promise<LaunchedBrowser> => {
  const browser = await chromium.launch({
    headless: options.headless ?? false,
    args: ['--lang=ja'],
  });
  const context = await browser.newContext({locale: 'ja',});
  if (options.timeoutMs) {
    context.setDefaultTimeout(options.timeoutMs);
    context.setDefaultNavigationTimeout(options.timeoutMs);
  }
  const page = await context.newPage();

  return {
    browser,
    context,
    page,
  };
};

/**
 * OTP 入力画面を自動操作し、最大3回までワンタイムパスワードを試行します。
 */
const handleOtpChallenge = async (
  page: Page,
  otpSecret: string,
): Promise<void> => {
  const otpFieldLocator = () =>
    page.getByRole('textbox', { name: OTP_INPUT_NAME }).first();

  if ((await otpFieldLocator().count()) === 0) {
    return;
  }

  if (!otpSecret) {
    throw new Error('OTP 用のシークレットが設定されていません。');
  }

  const signInButtonLocator = () =>
    page.getByRole('button', { name: 'サインイン' }).first();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const otpField = otpFieldLocator();
    await otpField.waitFor({ state: 'visible' });

    const token = authenticator.generate(otpSecret);
    await otpField.fill('');
    await otpField.fill(token);

    const signInButton = signInButtonLocator();
    if ((await signInButton.count()) === 0) {
      throw new Error('OTP 画面でサインインボタンが見つかりません。');
    }

    await signInButton.click();
    await page.waitForLoadState('domcontentloaded');

    if ((await otpFieldLocator().count()) === 0) {
      return;
    }

    await page.waitForTimeout(3000);
  }

  if ((await otpFieldLocator().count()) !== 0) {
    throw new Error('OTP 認証を自動で突破できませんでした。');
  }
};

/**
 * セラーセントラルのサインインからアカウント/リージョン選択までを自動化します。
 */
export const signInAmazon = async (
  options: SignInOptions,
): Promise<void> => {
  const {
    page,
    email,
    password,
    otpSecret,
    accountName,
  } = options;

  await page.goto(SIGN_IN_URL, { waitUntil: 'domcontentloaded' });
  const emailInput = page.getByRole('textbox', { name: EMAIL_INPUT_NAME }).first();
	await emailInput.waitFor({ state: 'visible' });
	await emailInput.fill(email);
	const nextButton = page.getByRole('button', { name: '次に進む' }).first();
	await nextButton.click();
  const passwordInput = page.getByRole('textbox', { name: PASSWORD_INPUT_NAME }).first();
  await passwordInput.waitFor({ state: 'visible' });
  await passwordInput.fill(password);
  const loginButton = page.getByRole('button', { name: 'ログイン' }).first();
  await loginButton.click();
  await page.waitForLoadState('domcontentloaded');

  await handleOtpChallenge(page, otpSecret);

  const accountButton = page.getByRole('button', { name: accountName }).first();
  await accountButton.waitFor({ state: 'visible' });
  await accountButton.click();

  const regionButton = page.getByRole('button', { name: REGION_NAME_DEFAULT }).first();
  await regionButton.waitFor({ state: 'visible' });
  await regionButton.click();

  const selectAccountButton = page.getByRole('button', { name: 'アカウントを選択' }).first();
  await selectAccountButton.waitFor({ state: 'visible' });
  await selectAccountButton.click();
};

/**
 * 合いのり出品対象の商品を検索し、エラー or 出品ページを結果として返します。
 */
export const searchAinoriProduct = async (
  page: Page,
  JANCode: string,
): Promise<SearchProductResult> => {
  await page.goto(PRODUCT_SEARCH_URL, { waitUntil: 'domcontentloaded' });

  const searchBox = page
    .getByRole('textbox', {
      name: '商品名、説明、キーワードを入力',
    })
    .first();
  await searchBox.waitFor({ state: 'visible' });
  await searchBox.click();
  await searchBox.fill(JANCode);

  await page
    .getByTestId('omnibox-submit-button')
    .getByRole('button', { name: '検索' })
    .click();
  await page.waitForTimeout(4000);

  const noResultsLocator = page
    .getByText('検索クエリに一致する結果が見つかりません')
    .first();
  if (await noResultsLocator.count()) {
    return {
      error: {
        JANCode,
        success: false,
        errorType: ERROR_TYPE.NOT_FOUND,
        errorMessage: '相乗り出品できない商品です',
      },
    };
  }

  const expandIcon = page.getByText('').first();
  await expandIcon.waitFor({ state: 'visible' });
  await expandIcon.click();
  await page.waitForLoadState('domcontentloaded');

  const brandRestrictionLocator = page
    .getByText('このブランドには出品許可が必要です。')
    .first();
  try {
    await brandRestrictionLocator.waitFor({ state: 'visible', timeout: 3000 });
    return {
      error: {
        JANCode,
        success: false,
        errorType: ERROR_TYPE.BLAND_ENTRY,
        errorMessage: 'ブランドの出品許可が必要なためスキップしました。',
      },
    };
  } catch {
    // ブランド制限なし
  }

  const secondaryToggle = page.locator('#katal-id-6').first();
  await secondaryToggle.waitFor({ state: 'visible' });
  await secondaryToggle.click();

  const listingCard = page.locator('.standard-option-content').first();
  await listingCard.waitFor({ state: 'visible' });
  await listingCard.click();

  const listingPagePromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'この商品を出品する' }).click();
  const listingPage = await listingPagePromise;
  await listingPage.waitForLoadState('domcontentloaded');
	await page.waitForTimeout(3000);
  return { listingPage };
};

/**
 * 出品ページで SKU・在庫・価格を入力し、登録処理を実行します。
 */
export const enterProductDetails = async (
  listingPage: Page,
  item: EntryItem,
): Promise<EntryResult | null> => {
  const skuBox = listingPage.getByRole('textbox', { name: 'SKU' });
  await skuBox.click();
  await skuBox.fill(item.JANCode);

  await listingPage
    .locator('kat-box')
    .filter({ hasText: '私はこの商品を自分で発送します' })
    .click();

  const inventoryInput = listingPage.getByRole('spinbutton', { name: '在庫数' });
  await inventoryInput.fill(item.stock.toString());

  const priceInput = listingPage.getByRole('textbox', { name: '商品の販売価格' });
  await priceInput.fill(item.price.toString());

  await listingPage.locator('div').filter({ hasText: /^送信$/ }).click();

  const registerButton = listingPage
    .getByRole('button', { name: '商品の登録' })
    .first();
  let hasRegisterButton = true;
  try {
    await registerButton.waitFor({ state: 'visible', timeout: 3000 });
  } catch {
    hasRegisterButton = false;
  }

  if (!hasRegisterButton) {
    await listingPage.close();
    return {
      JANCode: item.JANCode,
      success: false,
      errorType: ERROR_TYPE.INVALID_INPUT,
      errorMessage: '商品の入力情報が不正です',
    };
  }

  try {
    await Promise.all([
      listingPage.waitForLoadState('domcontentloaded'),
      registerButton.click(),
    ]);
    await listingPage.waitForTimeout(2000);
    return null;
  } finally {
    await listingPage.close();
  }
};

/**
 * 問題なく完了した出品結果のデータ行を生成します。
 */
export const buildSuccessResult = (item: EntryItem): EntryResult => ({
  JANCode: item.JANCode,
  price: item.price,
  stock: item.stock,
  success: true,
});

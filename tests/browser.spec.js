import { test as base, expect, chromium } from '@playwright/test';
import { liveSdkFixture } from './live-fixture.js';
// Start a fresh browser per scenario; this also supports headless-shell runtimes.
const test = base.extend({
  page: async ({ launchOptions, baseURL }, use) => {
    const browser = await chromium.launch(launchOptions);
    try {
      const context = await browser.newContext({ baseURL });
      await use(await context.newPage());
    } finally {
      await browser.close();
    }
  },
});
async function staffFixture(page, role) {
  await page.route('**/js/firebase.bundle.js', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `
    const makeUser=role=>({email:role+'@school.example',getIdToken:async()=>role});
    if(sessionStorage.getItem('fixture-initialised')===null){sessionStorage.setItem('fixture-initialised','1');sessionStorage.setItem('fixture-role',${role ? `'${role}'` : "''"});}
    const initial=sessionStorage.getItem('fixture-role');const auth={currentUser:initial ? makeUser(initial) : null};let listener;
    export async function initFirebase(){return {auth};}
    export function onAuthStateChanged(a,fn){listener=fn;queueMicrotask(()=>fn(a.currentUser));}
    export async function signInWithCustomToken(a,token){a.currentUser=makeUser(token);sessionStorage.setItem('fixture-role',token);listener?.(a.currentUser);return {user:a.currentUser};}
    export async function signOut(a){a.currentUser=null;sessionStorage.setItem('fixture-role','');listener?.(null);}
  `,
    }),
  );
}
async function capturePage(page, path) {
  for (const section of await page.locator('.motion-ready').all()) {
    await section.scrollIntoViewIfNeeded();
    await expect(section).toHaveCSS('opacity', '1');
  }
  await page.evaluate(() => {
    document.activeElement?.blur();
    window.scrollTo({ top: 0, behavior: 'instant' });
  });
  await page.screenshot({ path, fullPage: true });
}
let scenarioIp = 10;
test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ 'X-Forwarded-For': `192.0.2.${scenarioIp++}` });
  await page.route('https://api.cloudinary.com/v1_1/scmu-test/image/upload', (route) =>
    route.fulfill({
      json: { public_id: 'fixture-upload', secure_url: 'https://images.example/upload.jpg' },
    }),
  );
  await page.route('https://images.example/**', (route) =>
    route.fulfill({ path: 'public/assets/photos/classroom.jpg', contentType: 'image/jpeg' }),
  );
  await page.route('https://www.youtube.com/iframe_api', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: liveSdkFixture() }),
  );
  await page.route('https://connect.facebook.net/en_US/sdk.js', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: liveSdkFixture(true) }),
  );
  await page.route('https://www.facebook.com/plugins/video.php?*', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<html>Facebook player fixture</html>' }),
  );
  await page.route('https://www.youtube-nocookie.com/**', (route) =>
    route.fulfill({
      body: '<html><body>Test video player</body></html>',
      contentType: 'text/html',
    }),
  );
});
test('desktop home shows the Sinhala identity, six slides, events, live and board', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await expect(page.getByRole('dialog', { name: 'SCMU special event' })).toBeVisible();
  await page.getByRole('button', { name: 'Got it' }).click();
  await expect(page.locator('#hero-title')).toHaveText(/සඟබෝ\s+පැහැසර/);
  await expect(page.locator('.slide')).toHaveCount(6);
  await page.getByRole('button', { name: 'Next slide', exact: true }).click();
  await expect(page.locator('#slide-count')).toHaveText('02 / 06');
  await expect(page.locator('#slide-caption')).toHaveText('Learning at school');
  await page.getByRole('button', { name: 'Pause slideshow' }).click();
  await expect(page.getByRole('button', { name: 'Play slideshow' })).toBeVisible();
  await expect(page.locator('#event-title')).toHaveText('SCMU special event');
  await expect(page.locator('#event-date')).toBeHidden();
  await expect(page.locator('#live-section iframe')).toBeVisible();
  await expect(page.locator('.board-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Event notifications' }).click();
  await expect(page.getByRole('dialog', { name: 'Events & notifications' })).toBeVisible();
  await page.keyboard.press('Escape');
  await capturePage(page, 'test-results/home-desktop.png');
  expect(errors).toEqual([]);
});
test('mobile navigation, layout and two-field feedback work', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Got it' }).click();
  await page.getByRole('button', { name: 'Open menu', exact: true }).click();
  await page.locator('#navigation').getByRole('link', { name: 'Contact', exact: true }).click();
  await expect(page.locator('[data-feedback-form] input')).toHaveCount(1);
  await expect(page.locator('[data-feedback-form] textarea')).toHaveCount(1);
  await page.getByLabel('Your name').fill('SCMU visitor');
  await page.getByLabel('Your message').fill('A message from our school community.');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.locator('.feedback-form .form-status')).toContainText('received privately');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.evaluate(() => {
    document.activeElement?.blur();
    window.scrollTo(0, 0);
  });
  await capturePage(page, 'test-results/contact-mobile.png');
});
test('gallery groups exact albums and opens a keyboard lightbox with inert captions', async ({
  page,
}) => {
  await page.goto('/gallery');
  await page.getByRole('button', { name: 'Got it' }).click();
  await expect(page.locator('.gallery-album')).toHaveCount(2);
  const links = page.getByRole('link', { name: 'View more on Facebook' });
  await expect(links).toHaveCount(2);
  await expect(links.first()).toHaveAttribute('href', /set=a\.456/);
  await expect(page.locator('.photo-card img').first()).toHaveAttribute('loading', 'lazy');
  await page.locator('.photo-card').first().click();
  await expect(page.locator('#lightbox')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#lightbox-count')).toHaveText('2 / 4');
  await page.keyboard.press('Escape');
  await expect(page.locator('#lightbox')).not.toBeVisible();
  expect(await page.locator('.photo-card .photo-caption img').count()).toBe(0);
});
for (const [role, count] of [
  ['admin', 10],
  ['teacher', 4],
  ['student', 2],
])
  test(`${role} dashboard shows only permitted tools and private gallery metadata`, async ({
    page,
  }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await staffFixture(page, role);
    await page.goto('/admin/index.html');
    await expect(page.locator('#staff-role')).toHaveText(role);
    await expect(page.getByRole('tab')).toHaveCount(count);
    if (role !== 'admin')
      await expect(page.getByRole('tab', { name: 'Team photo', exact: true })).toHaveCount(0);
    await page.getByRole('tab', { name: 'Gallery', exact: true }).click();
    await expect(page.locator('#admin-gallery-grid .admin-content-card')).toHaveCount(4);
    if (role === 'student') {
      await expect(page.locator('#admin-gallery-grid')).not.toContainText('Posted by');
      await expect(page.getByRole('button', { name: 'Remove', exact: true })).toHaveCount(0);
    } else
      await expect(page.locator('#admin-gallery-grid')).toContainText('teacher@school.example');
    if (role === 'admin') {
      await page.getByRole('tab', { name: 'Head board' }).click();
      await expect(page.locator('#head-list .admin-content-card')).toHaveCount(1);
      await page.locator('#head-list').getByRole('button', { name: 'Edit', exact: true }).click();
      await page.locator('#head-name').fill('Updated board member');
      await page.getByRole('button', { name: 'Save board member' }).click();
      await expect(page.locator('#head-list')).toContainText('Updated board member');
      await page.screenshot({ path: 'test-results/admin-desktop.png', fullPage: true });
    }
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(/\/login\/index.html/);
    expect(errors).toEqual([]);
  });
test('staff sign-in uses server-verified SCMU password and redirects to dashboard', async ({
  page,
}) => {
  await staffFixture(page, null);
  await page.goto('/login/index.html');
  await expect(page.locator('#login-button')).toBeEnabled();
  await page.getByLabel('SCMU account email').fill('admin@school.example');
  await page.getByLabel('Password', { exact: true }).fill('unique-scmu-password');
  await page.locator('#login-button').click();
  await expect(page).toHaveURL(/\/admin\/index.html/);
  await expect(page.locator('#staff-role')).toHaveText('admin');
});

test('Student file publishing shows progress and registers the server permit', async ({ page }) => {
  await staffFixture(page, 'student');
  await page.goto('/admin/index.html');
  await expect(page.locator('#staff-role')).toHaveText('student');
  await page.locator('#gallery-file').setInputFiles({
    name: 'approved-photo.png',
    mimeType: 'image/png',
    buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  });
  await page.locator('#gallery-caption').fill('Published from file input');
  await page.getByRole('button', { name: 'Publish photograph' }).click();
  await expect(page.locator('#gallery-form .form-status')).toContainText('Saved successfully');
  await expect(page.locator('#admin-gallery-grid')).toContainText('Published from file input');
  await expect(page.locator('#admin-gallery-grid')).not.toContainText('Posted by');
});
test('Admin account/event/IP forms and maintenance/live controls save and remove correctly', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await staffFixture(page, 'admin');
  await page.goto('/admin/index.html');
  await expect(page.locator('#staff-role')).toHaveText('admin');
  await page.getByRole('tab', { name: 'Accounts', exact: true }).click();
  await page.locator('#account-name').fill('New contributor');
  await page.locator('#account-email').fill('new@school.example');
  await page.locator('#account-password').fill('unique-test-password');
  await page.getByRole('button', { name: 'Save account' }).click();
  await expect(page.locator('#account-list')).toContainText('New contributor');
  const account = page
    .locator('#account-list .staff-item')
    .filter({ hasText: 'new@school.example' });
  await account.getByRole('button', { name: 'Edit account' }).click();
  await page.locator('#account-role').selectOption('teacher');
  await page.getByRole('button', { name: 'Save account' }).click();
  await expect(account).toContainText('teacher');
  await account.getByRole('button', { name: 'Delete account' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await expect(account).toBeVisible();
  await account.getByRole('button', { name: 'Delete account' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(account).toHaveCount(0);
  await page.getByRole('tab', { name: 'Events', exact: true }).click();
  await page.locator('#popup-title').fill('New event notice');
  await page.locator('#popup-message').fill('Details for our school event.');
  await page.getByRole('button', { name: 'Publish event' }).click();
  await expect(page.locator('#popup-list')).toContainText('New event notice');
  await page.getByRole('tab', { name: 'IP blocks', exact: true }).click();
  await page.locator('#block-ip').fill('198.51.100.9');
  await page.locator('#block-reason').fill('Test access restriction');
  await page.getByRole('button', { name: 'Block staff access' }).click();
  await expect(page.locator('#ip-list')).toContainText('198.51.100.9');
  await page.locator('#ip-list').getByRole('button', { name: 'Unblock', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.locator('#ip-list')).not.toContainText('198.51.100.9');
  await page.getByRole('tab', { name: 'Live', exact: true }).click();
  await expect(page.locator('#live-form input[type=checkbox]')).toBeChecked();
  await page.locator('#live-form input[type=checkbox]').uncheck();
  await page.getByRole('button', { name: 'Save live status' }).click();
  await expect(page.locator('#live-form .form-status')).toContainText('Saved successfully');
  await page.getByRole('tab', { name: 'Availability', exact: true }).click();
  await page.locator('#settings-form input').check();
  await page.getByRole('button', { name: 'Save availability' }).click();
  await expect(page.locator('#settings-form .form-status')).toContainText('Saved successfully');
  const response = await page.request.get('/');
  expect(response.status()).toBe(503);
  await page.locator('#settings-form input').uncheck();
  await page.getByRole('button', { name: 'Save availability' }).click();
  await expect(page.locator('#settings-form .form-status')).toContainText('Saved successfully');
  expect((await page.request.get('/')).status()).toBe(200);
  expect(errors).toEqual([]);
});

for (const role of ['teacher', 'student'])
  test(`${role} publishes a special-event image from the dashboard`, async ({ page }) => {
    await staffFixture(page, role);
    await page.goto('/admin/index.html');
    await page.getByRole('tab', { name: 'Events', exact: true }).click();
    await expect(page.locator('#popup-list')).not.toContainText('Edit text');
    await expect(page.locator('#popup-list')).not.toContainText('Remove event');
    const title = `Special event by ${role}`;
    await page.getByLabel('Event title', { exact: true }).fill(title);
    await page.locator('#popups-form textarea').fill('Published by our media team.');
    await page.locator('#popup-file').setInputFiles({
      name: 'event.png',
      mimeType: 'image/png',
      buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    });
    await page.getByRole('button', { name: 'Publish event', exact: true }).click();
    await expect(page.locator('#popup-list')).toContainText(title);
    await page.goto('/');
    await expect(page.locator('#event-title')).toHaveText(title);
    await expect(page.locator('.featured-event-image')).toBeVisible();
    await expect(page.getByRole('dialog', { name: title })).toBeVisible();
  });
test('navigation highlights links and animates an accessible responsive menu', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Got it', exact: true }).click();
  const nav = page.locator('#navigation');
  const home = nav.locator('a[href="/"]'),
    gallery = nav.locator('a[href="/gallery"]'),
    contact = nav.locator('a[href="/contact"]');
  const highlight = (link) => link.evaluate((node) => getComputedStyle(node, '::before').opacity);
  expect(await highlight(home)).toBe('1');
  expect(await highlight(gallery)).toBe('0');
  await gallery.hover();
  await expect.poll(() => highlight(gallery)).toBe('1');
  await gallery.focus();
  await page.keyboard.press('Tab');
  await expect(contact).toBeFocused();
  await expect.poll(() => highlight(contact)).toBe('1');
  await expect(nav.locator('.nav-indicator')).toHaveCount(0);
  for (const width of [320, 390, 768, 800]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(nav).toBeHidden();
    expect(await nav.evaluate((node) => node.inert)).toBe(true);
    const toggle = page.getByRole('button', { name: 'Open menu', exact: true });
    await toggle.click();
    await expect(nav).toBeVisible();
    await expect(nav).toHaveCSS('opacity', '1');
    await expect.poll(() => nav.evaluate((node) => node.inert)).toBe(false);
    await contact.focus();
    await page.keyboard.press('Escape');
    await expect(nav).toBeHidden();
    await expect(toggle).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.setViewportSize({ width: 801, height: 844 });
  await expect(nav).toHaveCSS('position', 'relative');
  await expect(nav).toBeVisible();
  await expect.poll(() => nav.evaluate((node) => node.inert)).toBe(false);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await home.evaluate((node) => getComputedStyle(node, '::before').transitionDuration)).toBe(
    '0s',
  );
  await expect(page.locator('.special-event')).toHaveCSS('opacity', '1');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Open menu', exact: true }).click();
  await expect(nav).toHaveCSS('transition-duration', '0s');
  await page.getByRole('button', { name: 'Close menu', exact: true }).click();
  await expect(nav).toBeHidden();
  await page.getByRole('button', { name: 'Open menu', exact: true }).click();
  await gallery.click();
  await expect(page).toHaveURL(/\/gallery$/);
  await expect(page.locator('#navigation')).toBeHidden();
  await page.getByRole('button', { name: 'Open menu', exact: true }).click();
  await page.locator('main').click({ position: { x: 10, y: 350 } });
  await expect(page.locator('#navigation')).toBeHidden();
});

test('homepage special-event section has no hardcoded fallback when dashboard events are empty', async ({
  page,
}) => {
  await page.route('**/api/popups?*', (route) =>
    route.fulfill({ json: { items: [], nextCursor: null } }),
  );
  await page.goto('/');
  await expect(page.locator('.special-event')).toBeHidden();
  await expect(page.locator('#event-title')).toBeEmpty();
  await expect(page.locator('#event-message')).toBeEmpty();
  await page.getByRole('button', { name: 'Event notifications' }).click();
  await expect(page.getByRole('dialog')).toContainText('No event notices yet');
});

test('Cloudinary upload failure keeps form content and a retry publishes successfully', async ({
  page,
}) => {
  await staffFixture(page, 'student');
  let attempts = 0;
  await page.route('https://api.cloudinary.com/v1_1/scmu-test/image/upload', async (route) => {
    const request = route.request();
    expect(request.headers()['content-type']).toContain('multipart/form-data');
    expect(request.postData()).toContain('fixture-signature');
    expect(request.postData()).toContain('retry-photo.png');
    attempts++;
    await route.fulfill({
      status: attempts === 1 ? 503 : 200,
      json: attempts === 1 ? { error: { message: 'provider failed' } } : { public_id: 'uploaded' },
    });
  });
  await page.goto('/admin/index.html');
  await page.locator('#gallery-file').setInputFiles({
    name: 'retry-photo.png',
    mimeType: 'image/png',
    buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  });
  await page.locator('#gallery-caption').fill('Cloudinary retry test');
  await page.getByRole('button', { name: 'Publish photograph' }).click();
  await expect(page.locator('#gallery-form .form-status')).toContainText(
    'Cloudinary could not upload',
  );
  await expect(page.locator('#gallery-caption')).toHaveValue('Cloudinary retry test');
  await page.getByRole('button', { name: 'Publish photograph' }).click();
  await expect(page.locator('#gallery-form .form-status')).toContainText('Saved successfully');
  await expect(page.locator('#admin-gallery-grid')).toContainText('Cloudinary retry test');
  expect(attempts).toBe(2);
});

test('Sinhala hero heading fits narrow phones, tablets and desktop screens', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Got it', exact: true }).click();
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(width);
    const bounds = await page
      .locator('#hero-title')
      .evaluate((node) => ({ content: node.scrollWidth, available: node.clientWidth }));
    expect(bounds.content).toBeLessThanOrEqual(bounds.available);
  }
  await page.locator('.hero').screenshot({ path: 'test-results/hero-larger-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.hero').screenshot({ path: 'test-results/hero-larger-mobile.png' });
});

async function dropFiles(page, inputId, files) {
  await page.locator(`#${inputId}`).evaluate((input, values) => {
    const transfer = new DataTransfer();
    for (const file of values) {
      const bytes = file.size
        ? new Uint8Array(file.size)
        : Uint8Array.from(
            atob(
              'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS1cAAAAASUVORK5CYII=',
            ),
            (c) => c.charCodeAt(0),
          );
      transfer.items.add(new File([bytes], file.name, { type: file.type }));
    }
    input
      .closest('.upload-dropzone')
      .dispatchEvent(
        new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }),
      );
  }, files);
}

test('all four dashboard image controls support drop previews, clearing and the native picker', async ({
  page,
}) => {
  await staffFixture(page, 'admin');
  await page.goto('/admin/index.html');
  for (const [tab, inputId] of [
    ['Gallery', 'gallery-file'],
    ['Image slider', 'slider-file'],
    ['Events', 'popup-file'],
    ['Head board', 'head-file'],
  ]) {
    await page.getByRole('tab', { name: tab, exact: true }).click();
    const zone = page.locator(`#${inputId}`).locator('..');
    await dropFiles(page, inputId, [{ name: 'preview.png', type: 'image/png' }]);
    await expect(zone.locator('.upload-selection')).toContainText('preview.png');
    await expect(zone.locator('.upload-preview')).toBeVisible();
    await expect
      .poll(() => zone.locator('.upload-preview').evaluate((image) => image.naturalWidth))
      .toBeGreaterThan(0);
    await zone.getByRole('button', { name: 'Remove selected image' }).click();
    await expect(zone.locator('.upload-preview')).toBeHidden();
    expect(await page.locator(`#${inputId}`).evaluate((input) => input.files.length)).toBe(0);
    await page.locator(`#${inputId}`).focus();
    await expect(page.locator(`#${inputId}`)).toBeFocused();
  }
  await page.getByRole('tab', { name: 'Events', exact: true }).click();
  await page
    .locator('#popup-list')
    .getByRole('button', { name: 'Edit text', exact: true })
    .first()
    .click();
  await expect(page.locator('#popup-file')).toBeDisabled();
  await dropFiles(page, 'popup-file', [{ name: 'blocked.png', type: 'image/png' }]);
  expect(await page.locator('#popup-file').evaluate((input) => input.files.length)).toBe(0);
});

test('drop areas reject unsupported, oversized and multiple files without requesting uploads', async ({
  page,
}) => {
  await staffFixture(page, 'student');
  await page.goto('/admin/index.html');
  const zone = page.locator('#gallery-file').locator('..');
  for (const [files, message] of [
    [[{ name: 'unsafe.svg', type: 'image/svg+xml' }], 'Choose a JPG'],
    [[{ name: 'large.png', type: 'image/png', size: 10 * 1024 * 1024 + 1 }], 'Choose a JPG'],
    [
      [
        { name: 'one.png', type: 'image/png' },
        { name: 'two.png', type: 'image/png' },
      ],
      'Drop one image',
    ],
  ]) {
    await dropFiles(page, 'gallery-file', files);
    await expect(zone.locator('.upload-selection')).toContainText(message);
    expect(await page.locator('#gallery-file').evaluate((input) => input.files.length)).toBe(0);
  }
  await page.locator('#gallery-file').setInputFiles({
    name: 'unsafe.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg/>'),
  });
  await expect(zone.locator('.upload-selection')).toContainText('Choose a JPG');
  expect(await page.locator('#gallery-file').evaluate((input) => input.files.length)).toBe(0);
});

test('mobile Student drop upload publishes through Cloudinary and locks selection during upload', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await staffFixture(page, 'student');
  let release;
  const uploading = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('https://api.cloudinary.com/v1_1/scmu-test/image/upload', async (route) => {
    await uploading;
    await route.fulfill({ json: { public_id: 'fixture-upload' } });
  });
  await page.goto('/admin/index.html');
  const zone = page.locator('#gallery-file').locator('..');
  await dropFiles(page, 'gallery-file', [{ name: 'dropped.png', type: 'image/png' }]);
  await page.locator('#gallery-caption').fill('Published by drag and drop');
  await zone.screenshot({ path: 'test-results/drop-upload-mobile.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole('button', { name: 'Publish photograph' }).click();
  await expect(zone).toHaveAttribute('aria-disabled', 'true');
  await dropFiles(page, 'gallery-file', [{ name: 'replacement.png', type: 'image/png' }]);
  expect(await page.locator('#gallery-file').evaluate((input) => input.files[0].name)).toBe(
    'dropped.png',
  );
  release();
  await expect(page.locator('#gallery-form .form-status')).toContainText('Saved successfully');
  await expect(page.locator('#admin-gallery-grid')).toContainText('Published by drag and drop');
  await expect(zone.locator('.upload-preview')).toBeHidden();
  await expect(zone.locator('.upload-selection')).toBeEmpty();
});

test('staff access loading shows the favicon and respects reduced motion', async ({ page }) => {
  await staffFixture(page, 'student');
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('**/api/admin/me', async (route) => {
    await gate;
    await route.continue();
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/admin/index.html');
  try {
    const logo = page.locator('#auth-loading .loading-logo');
    await expect(logo).toHaveAttribute('src', '/assets/favicon.svg');
    await expect.poll(() => logo.evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);
    await expect(logo).toHaveCSS('width', '72px');
    for (const width of [390, 995, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      const centers = await logo.evaluate((image) => {
        const icon = image.getBoundingClientRect();
        const container = image.parentElement.getBoundingClientRect();
        return { icon: icon.x + icon.width / 2, container: container.x + container.width / 2 };
      });
      expect(Math.abs(centers.icon - centers.container)).toBeLessThan(1);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('status')).toContainText('Checking your staff access');
    await expect(logo).toHaveCSS('animation-name', 'logo-pulse');
    await page.screenshot({ path: 'test-results/favicon-loading-mobile.png', fullPage: true });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(logo).toHaveCSS('animation-name', 'none');
  } finally {
    release();
  }
  await expect(page.locator('#dashboard')).toBeVisible();
});

// Use real canvas-encoded images, rather than padded headers, to exercise the
// browser decoder, compression, transparency and camera-orientation handling.
async function selectLargePhoto(page, type, rotated = false) {
  return page.locator('#gallery-file').evaluate(
    async (input, { type, rotated }) => {
      const canvas = document.createElement('canvas');
      canvas.width = 3000;
      canvas.height = 900;
      const context = canvas.getContext('2d');
      const pixels = context.createImageData(canvas.width, canvas.height);
      let random = 17;
      for (let i = 0; i < pixels.data.length; i += 4) {
        for (let channel = 0; channel < 3; channel++) {
          random = (Math.imul(random, 1664525) + 1013904223) | 0;
          pixels.data[i + channel] = random >>> 24;
        }
        pixels.data[i + 3] = type === 'image/png' && (i / 4) % canvas.width < 300 ? 0 : 255;
      }
      context.putImageData(pixels, 0, 0);
      let blob = await new Promise((resolve) => canvas.toBlob(resolve, type, 0.98));
      if (rotated) {
        // EXIF orientation 6: a phone photo that should display in portrait.
        const jpeg = new Uint8Array(await blob.arrayBuffer());
        const exif = new Uint8Array([
          0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0, 0, 0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 1,
          0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0,
        ]);
        blob = new Blob([jpeg.slice(0, 2), exif, jpeg.slice(2)], { type });
      }
      const reference = new Image();
      const referenceUrl = URL.createObjectURL(blob);
      try {
        reference.src = referenceUrl;
        await reference.decode();
        const ratio = Math.min(1, 2400 / Math.max(reference.naturalWidth, reference.naturalHeight));
        canvas.width = Math.round(reference.naturalWidth * ratio);
        canvas.height = Math.round(reference.naturalHeight * ratio);
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(reference, 0, 0, canvas.width, canvas.height);
        window.previousPreparedSize = (
          await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.88))
        ).size;
      } finally {
        URL.revokeObjectURL(referenceUrl);
      }
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([blob], type === 'image/png' ? 'large.png' : 'phone.jpg', { type }),
      );
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      canvas.width = canvas.height = 0;
      return blob.size;
    },
    { type, rotated },
  );
}

function multipartFile(request) {
  const boundary = request.headers()['content-type'].match(/boundary=([^;]+)/)[1];
  const body = request.postDataBuffer();
  const headerStart = body.indexOf(Buffer.from('name="file";'));
  expect(headerStart).toBeGreaterThanOrEqual(0);
  const start = body.indexOf(Buffer.from('\r\n\r\n'), headerStart) + 4;
  const end = body.indexOf(Buffer.from(`\r\n--${boundary}`), start);
  expect(end).toBeGreaterThan(start);
  const headers = body.subarray(headerStart, start).toString();
  return {
    name: headers.match(/filename="([^"]+)"/)[1],
    type: headers.match(/Content-Type: ([^\r]+)/)[1],
    bytes: body.subarray(start, end),
  };
}

for (const type of ['image/png', 'image/jpeg'])
  test(`large ${type} upload reduces bytes, matches its permit and preserves image properties`, async ({
    page,
  }) => {
    await staffFixture(page, 'student');
    const tickets = [],
      uploads = [];
    await page.route('**/api/uploads/ticket', async (route) => {
      tickets.push(route.request().postDataJSON());
      await route.continue();
    });
    await page.route('https://api.cloudinary.com/v1_1/scmu-test/image/upload', async (route) => {
      const file = multipartFile(route.request());
      uploads.push(file);
      expect(file.type).toBe(tickets.at(-1).contentType);
      expect(file.bytes.length).toBe(tickets.at(-1).size);
      expect(file.name).toMatch(/\.webp$/);
      await route.fulfill({
        status: type === 'image/jpeg' && uploads.length === 1 ? 503 : 200,
        json: {},
      });
    });
    await page.goto('/admin/index.html');
    await page.evaluate(() => {
      const decode = window.createImageBitmap;
      window.preparationDecodes = 0;
      window.createImageBitmap = (...args) => {
        window.preparationDecodes++;
        return decode(...args);
      };
    });
    const originalSize = await selectLargePhoto(page, type, type === 'image/jpeg');
    expect(originalSize).toBeGreaterThanOrEqual(512 * 1024);
    expect(originalSize).toBeLessThan(10 * 1024 * 1024);
    await expect.poll(() => page.evaluate(() => window.preparationDecodes)).toBe(1);
    const preparation = await page.evaluate(async () => {
      const { preparePhoto } = await import('/js/upload.js');
      const file = document.querySelector('#gallery-file').files[0];
      const first = preparePhoto(file);
      const prepared = await first;
      return {
        samePromise: first === preparePhoto(file),
        type: prepared.type,
        size: prepared.size,
      };
    });
    expect(preparation.samePromise).toBe(true);
    expect(preparation.type).toBe('image/webp');
    expect(tickets).toHaveLength(0);
    expect(uploads).toHaveLength(0);
    await page.locator('#gallery-caption').fill(`Prepared ${type} photograph`);
    await page.getByRole('button', { name: 'Publish photograph' }).click();
    if (type === 'image/jpeg') {
      await expect(page.locator('#gallery-form .form-status')).toContainText(
        'Cloudinary could not upload',
      );
      await page.getByRole('button', { name: 'Publish photograph' }).click();
    }
    await expect(page.locator('#gallery-form .form-status')).toContainText('Saved successfully');
    await expect(page.locator('#admin-gallery-grid')).toContainText(`Prepared ${type} photograph`);
    expect(uploads[0].bytes.length).toBeLessThan(originalSize * 0.9);
    const previousSize = await page.evaluate(() => window.previousPreparedSize);
    expect(uploads[0].bytes.length).toBeLessThan(previousSize * 0.85);
    console.log(`${type}: previous ${previousSize} bytes, now ${uploads[0].bytes.length} bytes`);
    expect(await page.evaluate(() => window.preparationDecodes)).toBe(1);
    if (type === 'image/jpeg') expect(uploads[0].bytes.equals(uploads[1].bytes)).toBe(true);
    const image = await page.evaluate(async (base64) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/webp' }));
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d');
      context.drawImage(bitmap, 0, 0);
      const result = {
        width: bitmap.width,
        height: bitmap.height,
        alpha: context.getImageData(0, 0, 1, 1).data[3],
      };
      bitmap.close();
      return result;
    }, uploads[0].bytes.toString('base64'));
    expect([image.width, image.height]).toEqual(type === 'image/png' ? [2048, 614] : [614, 2048]);
    expect(image.alpha).toBe(type === 'image/png' ? 0 : 255);
  });

test('image preparation preserves small/animated formats and falls back safely on limited browsers', async ({
  page,
}) => {
  await staffFixture(page, 'student');
  await page.goto('/admin/index.html');
  await selectLargePhoto(page, 'image/png');
  const results = await page.evaluate(async () => {
    const { prepareImage } = await import('/js/image-preparation.js');
    const file = document.querySelector('#gallery-file').files[0];
    const animation = Uint8Array.from(
      atob(
        'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACGFjVEwAAAACAAAAAPONk3AAAAAaZmNUTAAAAAAAAAACAAAAAgAAAAAAAAAAAAEACgAA6FTcAAAAABRJREFUeJxj/M/A8J+BgYGBiQEKAB8XAgJPlM6+AAAAGmZjVEwAAAABAAAAAgAAAAIAAAAAAAAAAAABAAoAAHMnNtQAAAAYZmRBVAAAAAJ4nGNkYPj/n4GBgYGJAQoAHRkCAunm7jEAAAAASUVORK5CYII=',
      ),
      (c) => c.charCodeAt(0),
    );
    const originals = [
      new File([new Uint8Array(100)], 'small.png', { type: 'image/png' }),
      new File([new Uint8Array(600_000)], 'animated.gif', { type: 'image/gif' }),
      new File([new Uint8Array(600_000)], 'animated.webp', { type: 'image/webp' }),
      new File([animation, new Uint8Array(600_000)], 'animated.png', { type: 'image/png' }),
      new File([new Uint8Array(600_000)], 'invalid.jpg', { type: 'image/jpeg' }),
    ];
    const preserved = [];
    for (const original of originals) preserved.push((await prepareImage(original)) === original);
    const decode = window.createImageBitmap;
    let fallbackSmaller, failedEncoderOriginal;
    try {
      window.createImageBitmap = undefined;
      fallbackSmaller = (await prepareImage(file)).size < file.size * 0.9;
    } finally {
      window.createImageBitmap = decode;
    }
    const encode = HTMLCanvasElement.prototype.toBlob;
    try {
      HTMLCanvasElement.prototype.toBlob = function (callback) {
        callback(null);
      };
      failedEncoderOriginal = (await prepareImage(file)) === file;
    } finally {
      HTMLCanvasElement.prototype.toBlob = encode;
    }
    return { preserved, fallbackSmaller, failedEncoderOriginal };
  });
  expect(results).toEqual({
    preserved: [true, true, true, true, true],
    fallbackSmaller: true,
    failedEncoderOriginal: true,
  });
});

test('successful publishing starts list and count refreshes concurrently', async ({ page }) => {
  await staffFixture(page, 'student');
  await page.goto('/admin/index.html');
  await expect
    .poll(() => page.locator('#admin-gallery-grid .admin-content-card').count())
    .toBeGreaterThan(0);
  await expect(page.locator('#stats .stat-card')).toHaveCount(2);
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let listStarted = false,
    countsStarted = false;
  await page.route('**/api/gallery?*', async (route) => {
    listStarted = true;
    await gate;
    await route.continue();
  });
  await page.route('**/api/admin/stats', async (route) => {
    countsStarted = true;
    await gate;
    await route.continue();
  });
  await page.locator('#gallery-url').fill('https://images.example/parallel.jpg');
  await page.locator('#gallery-caption').fill('Parallel refresh');
  await page.getByRole('button', { name: 'Publish photograph' }).click();
  try {
    await expect.poll(() => listStarted && countsStarted).toBe(true);
    await expect(page.locator('#gallery-form .form-status')).toContainText('Saved successfully');
  } finally {
    release();
  }
  await expect(page.locator('#admin-gallery-grid')).toContainText('Parallel refresh');
  await expect(page.getByRole('button', { name: 'Publish photograph' })).toBeEnabled();
});

test('Admin manages the landscape About team photo while public social rows omit the email icon', async ({
  page,
}) => {
  await staffFixture(page, 'admin');
  await page.goto('/admin/index.html');
  await page.getByRole('tab', { name: 'Team photo', exact: true }).click();
  await expect(page.locator('#team-photo-preview')).toContainText('No team photograph');
  await dropFiles(page, 'team-photo-file', [{ name: 'scmu-team.png', type: 'image/png' }]);
  await page.locator('#team-photo-form-caption').fill('SCMU team photograph');
  const permit = page.waitForRequest((r) => r.url().endsWith('/api/uploads/ticket'));
  await page.getByRole('button', { name: 'Publish team photo', exact: true }).click();
  expect((await permit).postDataJSON().collection).toBe('teamPhoto');
  await expect(page.locator('#teamPhoto-form .form-status')).toContainText('Saved successfully');
  await expect(page.locator('#team-photo-preview > img')).toHaveAttribute(
    'src',
    'https://images.example/upload.jpg',
  );
  await page.goto('/');
  const dismiss = page.getByRole('button', { name: 'Got it', exact: true });
  if (await dismiss.count()) await dismiss.click();
  await expect(page.locator('#about-team-photo')).toBeVisible();
  await expect(page.locator('#team-photo-caption')).toHaveText('SCMU team photograph');
  await expect(page.locator('#team-photo-image')).toHaveAttribute(
    'src',
    'https://images.example/upload.jpg',
  );
  await page.locator('.introduction').scrollIntoViewIfNeeded();
  const ratio = await page
    .locator('#team-photo-image')
    .evaluate((img) => img.clientWidth / img.clientHeight);
  expect(ratio).toBeCloseTo(16 / 9, 1);
  await expect(page.locator('.social-links .social-link.email')).toHaveCount(0);
  await expect(page.locator('.social-links use[href="/assets/icons.svg#mail"]')).toHaveCount(0);
  expect(await page.locator('a[href="mailto:sangabopahasara@gmail.com"]').count()).toBeGreaterThan(
    0,
  );
  await page.locator('.introduction').screenshot({ path: 'test-results/about-team-photo.png' });
  await page.goto('/admin/index.html');
  await page.getByRole('tab', { name: 'Team photo', exact: true }).click();
  await page.locator('#team-photo-url').fill('https://images.example/replacement-team.jpg');
  await page.locator('#team-photo-form-caption').fill('Updated team photograph');
  await page.getByRole('button', { name: 'Publish team photo', exact: true }).click();
  await expect(page.locator('#teamPhoto-form .form-status')).toContainText('Saved successfully');
  await expect(page.locator('#team-photo-preview > img')).toHaveAttribute(
    'src',
    'https://images.example/replacement-team.jpg',
  );
  await page.getByRole('button', { name: 'Remove team photo', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.locator('#teamPhoto-form .form-status')).toContainText('Team photo removed');
  await expect(page.locator('#team-photo-preview')).toContainText('No team photograph');
  await page.goto('/');
  await expect(page.locator('#about-team-photo')).toBeHidden();
});

async function publishedLive(page, platform = 'youtube') {
  const live =
    platform === 'youtube'
      ? {
          platform,
          url: 'https://youtu.be/dQw4w9WgXcQ',
          embedUrl: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
        }
      : {
          platform,
          url: 'https://www.facebook.com/scmu/videos/123/',
          embedUrl:
            'https://www.facebook.com/plugins/video.php?href=https%3A%2F%2Fwww.facebook.com%2Fscmu%2Fvideos%2F123%2F&show_text=false',
        };
  await page.route('**/api/live', (route) => route.fulfill({ json: { isLive: true, ...live } }));
}

for (const platform of ['youtube', 'facebook']) {
  for (const width of [1440, 390, 320]) {
    test(`${platform} preloads before scrolling and requests audio on entry at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await publishedLive(page, platform);
      const sources = [];
      await page.route(
        platform === 'youtube'
          ? 'https://www.youtube-nocookie.com/**'
          : 'https://www.facebook.com/plugins/video.php?*',
        (route) => {
          sources.push(new URL(route.request().url()));
          return route.fulfill({
            contentType: 'text/html',
            body: '<html>Prepared player fixture</html>',
          });
        },
      );
      await page.goto('/');
      await page.getByRole('button', { name: 'Got it', exact: true }).click();
      await expect(page.locator('#live-play')).toBeEnabled();
      await expect.poll(() => sources.length).toBe(1);
      expect(sources[0].searchParams.get('autoplay')).toBe(platform === 'youtube' ? '0' : 'false');
      expect(sources[0].searchParams.get('mute')).toBe('0');
      expect(await page.evaluate(() => liveFixture.commands)).toEqual([]);
      if (platform === 'youtube') {
        expect(sources[0].searchParams.get('enablejsapi')).toBe('1');
        expect(sources[0].searchParams.get('origin')).toBe('http://127.0.0.1:9080');
        expect(sources[0].searchParams.get('playsinline')).toBe('1');
      }
      const viewer = page.locator('#live-frame');
      await viewer.evaluate((node) =>
        window.scrollTo({
          top: node.getBoundingClientRect().top + scrollY - innerHeight + 15,
          behavior: 'instant',
        }),
      );
      await expect
        .poll(() => viewer.evaluate((node) => node.getBoundingClientRect().top < innerHeight))
        .toBe(true);
      expect(await page.evaluate(() => liveFixture.commands)).toEqual([]);
      await viewer.scrollIntoViewIfNeeded();
      await expect
        .poll(() => page.evaluate(() => liveFixture.commands.map((c) => c.action)))
        .toEqual(['unmute', 'play']);
      await expect(page.locator('#live-status')).toContainText('Live broadcast playing');
      await expect(page.locator('#live-play')).toBeHidden();
      await expect(page.locator('#live-frame iframe')).toHaveAttribute('allow', /autoplay/);
      await page.evaluate(() => liveFixture.pause());
      await expect(page.locator('#live-play')).toBeVisible();
      await page.locator('#hero-title').scrollIntoViewIfNeeded();
      await viewer.scrollIntoViewIfNeeded();
      expect(sources).toHaveLength(1);
      expect(await page.evaluate(() => liveFixture.commands.length)).toBe(2);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    });
  }
  test(`${platform} blocked audio has a working play-with-sound button`, async ({ page }) => {
    await page.addInitScript(() => {
      window.blockLiveAutoplay = true;
    });
    await publishedLive(page, platform);
    await page.goto('/');
    await page.getByRole('button', { name: 'Got it', exact: true }).click();
    await expect(page.locator('#live-play')).toBeEnabled();
    await page.locator('#live-frame').scrollIntoViewIfNeeded();
    await expect.poll(() => page.evaluate(() => liveFixture.commands.length)).toBe(2);
    await expect(page.locator('#live-play')).toBeVisible();
    await page.getByRole('button', { name: 'Play with sound', exact: true }).click();
    await expect(page.locator('#live-status')).toContainText('Live broadcast playing');
    expect(await page.evaluate(() => liveFixture.commands.at(-1).userActive)).toBe(true);
    expect(await page.evaluate(() => liveFixture.commands.map((c) => c.action))).toEqual([
      'unmute',
      'play',
      'unmute',
      'play',
    ]);
  });
  test(`${platform} SDK failure retains native controls and external broadcast link`, async ({
    page,
  }) => {
    await publishedLive(page, platform);
    await page.route(
      platform === 'youtube'
        ? 'https://www.youtube.com/iframe_api'
        : 'https://connect.facebook.net/en_US/sdk.js',
      (route) => route.abort(),
    );
    await page.goto('/');
    await expect(page.locator('#live-status')).toContainText('Press Play in the video player');
    await expect(page.locator('#live-frame iframe')).toHaveAttribute('src', /autoplay=(0|false)/);
    await expect(page.locator('#live-play')).toBeHidden();
    await expect(page.locator('#live-link')).toHaveAttribute('href', /^https:\/\//);
  });
}

test('live waits for readiness and never starts after scrolling away before ready', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.holdLiveReady = true;
  });
  await publishedLive(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Got it', exact: true }).click();
  await expect.poll(() => page.evaluate(() => !!window.liveFixture?.ready)).toBe(true);
  await page.locator('#live-frame').scrollIntoViewIfNeeded();
  await page.locator('#hero-title').scrollIntoViewIfNeeded();
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await page.evaluate(() => liveFixture.ready());
  await expect(page.locator('#live-play')).toBeEnabled();
  expect(await page.evaluate(() => liveFixture.commands)).toEqual([]);
  await page.locator('#live-frame').scrollIntoViewIfNeeded();
  await expect.poll(() => page.evaluate(() => liveFixture.commands.length)).toBe(2);
});

test('without IntersectionObserver the live player remains manual with sound available', async ({
  page,
}) => {
  await page.addInitScript(() => {
    delete window.IntersectionObserver;
  });
  await publishedLive(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Got it', exact: true }).click();
  await expect(page.locator('#live-play')).toBeEnabled();
  expect(await page.evaluate(() => liveFixture.commands)).toEqual([]);
  await page.getByRole('button', { name: 'Play with sound', exact: true }).click();
  await expect(page.locator('#live-status')).toContainText('Live broadcast playing');
});

test('unpublished or untrusted live sources stay hidden and do not load player SDKs', async ({
  page,
}) => {
  for (const live of [
    { isLive: false, embedUrl: '' },
    { isLive: true, embedUrl: 'https://untrusted.example/embed/video' },
  ]) {
    await page.route('**/api/live', (route) => route.fulfill({ json: live }));
    await page.goto('/');
    await expect(page.locator('#live-section')).toBeHidden();
    await expect(page.locator('#live-frame iframe')).toHaveCount(0);
    await expect(
      page.locator(
        'script[src="https://www.youtube.com/iframe_api"],script[src="https://connect.facebook.net/en_US/sdk.js"]',
      ),
    ).toHaveCount(0);
    await page.unroute('**/api/live');
  }
});

for (const platform of ['youtube', 'facebook']) {
  test(`${platform} readiness timeout leaves a manual player and ignores late readiness`, async ({
    page,
  }) => {
    await page.clock.install();
    await page.addInitScript(() => {
      window.holdLiveReady = true;
    });
    await publishedLive(page, platform);
    await page.goto('/');
    await expect.poll(() => page.evaluate(() => !!window.liveFixture?.ready)).toBe(true);
    await page.clock.runFor(12_100);
    await expect(page.locator('#live-status')).toContainText('Press Play in the video player');
    await expect(page.locator('#live-frame iframe')).toHaveCount(1);
    await expect(page.locator('#live-play')).toBeHidden();
    await page.evaluate(() => liveFixture.ready());
    await expect(page.locator('#live-play')).toBeHidden();
    expect(await page.evaluate(() => liveFixture.commands)).toEqual([]);
  });
}

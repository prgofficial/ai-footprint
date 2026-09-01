import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { seedDatabase, TOTAL_PROMPTS } from './fixtures';

const HOME = process.env.AI_FOOTPRINT_E2E_HOME as string;

async function completeOnboarding(page: Page): Promise<void> {
  await page.request.post('/api/settings/onboarding-complete');
}

test.describe('first run', () => {
  test('a new install lands on the wizard and offers to connect', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/welcome/);
    await expect(page.getByRole('heading', { name: 'Understand how you use AI.' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Connect Claude Code/ })).toBeVisible();
    await expect(
      page.getByText(/never leave this machine|nothing is sent anywhere/i).first(),
    ).toBeVisible();
  });

  test('the wizard states where data is stored before anything is connected', async ({ page }) => {
    await page.goto('/welcome');
    await expect(page.getByText(/Data is stored at/i)).toBeVisible();
    await expect(page.getByText(/Secrets found in prompts are redacted/i)).toBeVisible();
  });

  test('skipping the wizard reaches the dashboard', async ({ page }) => {
    await page.goto('/welcome');
    await page.getByRole('button', { name: 'Skip for now' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  });
});

test.describe('empty state', () => {
  test.beforeEach(async ({ page }) => {
    await completeOnboarding(page);
  });

  test('the dashboard is polished with zero data and offers the next step', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('No AI activity yet')).toBeVisible();
    await expect(page.getByRole('link', { name: /Connect a tool/ })).toBeVisible();
  });
});

test.describe('with real analytics', () => {
  test.beforeAll(async ({ request }) => {
    await request.post('/api/settings/onboarding-complete');
    await seedDatabase(request, HOME);
  });

  test.beforeEach(async ({ page }) => {
    await completeOnboarding(page);
  });

  test('the overview shows numbers derived from the ingested events', async ({ page }) => {
    await page.goto('/?range=30d');
    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
    await expect(page.getByText('Top areas')).toBeVisible();
    await expect(page.getByRole('link', { name: 'aurora' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Debugging' })).toBeVisible();
  });

  test('every figure on the overview follows the range filter', async ({ page, request }) => {
    for (const range of ['7d', 'all']) {
      const body = (await (
        await request.get(`/api/analytics/overview?range=${range}&timezone=UTC`)
      ).json()) as { totals: { prompts: number; sessions: number } };

      await page.goto(`/?range=${range}`);
      await expect(
        page.getByText(`${body.totals.prompts} prompts across ${body.totals.sessions} sessions`),
      ).toBeVisible();
      // "Today" is a range to choose, not a second window pinned above the chosen one.
      await expect(page.getByRole('heading', { name: 'Today' })).toHaveCount(0);
    }
  });

  test('the overview reports tokens, cost and the work behind them', async ({ page }) => {
    await page.goto('/?range=30d');
    // "API-equivalent" when a subscription is detected, "Estimated cost" otherwise.
    await expect(page.getByText(/Estimated cost|API-equivalent/).first()).toBeVisible();
    await expect(page.getByText('Cache reuse')).toBeVisible();
    await expect(page.getByText('Tool calls')).toBeVisible();
    await expect(page.getByRole('link', { name: 'claude-opus-4-8' })).toBeVisible();
  });

  test('the timeline redraws for another metric', async ({ page }) => {
    await page.goto('/?range=30d');
    await expect(page.getByRole('img', { name: 'Prompts over time' })).toBeVisible();
    await page.getByRole('button', { name: 'Tokens', exact: true }).click();
    await expect(page.getByRole('img', { name: 'Tokens over time' })).toBeVisible();
  });

  test('a chart can be read as a table', async ({ page }) => {
    await page.goto('/?range=30d');
    await page.getByRole('button', { name: 'Show data' }).first().click();
    await expect(page.getByRole('table').first()).toBeVisible();
  });

  test('the activity feed lists events and filters by type', async ({ page }) => {
    await page.goto('/activity?range=30d');
    await expect(page.getByText(/fix the failing login test/).first()).toBeVisible();

    await page.getByLabel('Event type').selectOption('tool_call');
    await expect(page.getByText('Nothing here yet')).toBeVisible();
  });

  test('prompt search finds a prompt and opens its detail', async ({ page }) => {
    await page.goto('/prompts?range=30d');
    await page.getByLabel('Search prompts').fill('docker swarm');
    await expect(page.getByText(/deploy the docker swarm stack/).first()).toBeVisible({
      timeout: 10_000,
    });

    await page
      .getByText(/deploy the docker swarm stack/)
      .first()
      .click();
    const detail = page.getByRole('complementary', { name: 'Prompt detail' });
    await expect(detail).toBeVisible();
    await expect(detail.getByText('DevOps').first()).toBeVisible();
    await expect(detail.getByText('Docker').first()).toBeVisible();
  });

  test('filters narrow the data and can be cleared', async ({ page }) => {
    await page.goto('/prompts?range=30d');
    await page.getByLabel('All projects').selectOption({ label: 'borealis' });
    await expect(page).toHaveURL(/projectId=/);
    await expect(page.getByText(/fix the failing login test/)).toHaveCount(0);

    await page.getByRole('button', { name: /Clear 1 filter/ }).click();
    await expect(page.getByText(/fix the failing login test/).first()).toBeVisible();
  });

  test('projects are inferred without any manual tagging', async ({ page }) => {
    await page.goto('/projects?range=30d');
    await expect(page.getByRole('link', { name: 'aurora' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'borealis' })).toBeVisible();
  });

  test('a session opens a timeline', async ({ page }) => {
    await page.goto('/sessions?range=30d');
    await page
      .getByRole('button', { name: /prompts/ })
      .first()
      .click();
    await expect(page.getByRole('complementary', { name: 'Session detail' })).toBeVisible();
  });

  test('insights are backed by a visible sample size, or say nothing', async ({ page }) => {
    await page.goto('/insights?range=30d');
    // Either observations with their denominator stated, or an explanation of the silence.
    await expect(
      page.getByText(/from \d[\d,]* prompts|Not enough to go on|not enough data/i).first(),
    ).toBeVisible();
  });

  test('the profile states its conclusion before its working', async ({ page }) => {
    await page.goto('/profile?range=30d');
    await expect(page.getByRole('heading', { name: 'Your AI Footprint' })).toBeVisible();
    // The conclusion, stated in words, before any figure.
    await expect(page.getByText(/^You used AI .*Claude Code/)).toBeVisible();
    await expect(page.getByText('Tool concentration')).toBeVisible();
    await expect(page.getByText('What you bring to AI')).toBeVisible();
  });

  test('settings expose the data location and both exports', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByText('Data location')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Export JSON' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Export CSV' })).toBeVisible();
  });

  test('deleting requires a preview and a typed confirmation', async ({ page }) => {
    await page.goto('/settings');
    // The scope must be unmistakable: this clears the app's own database, not the AI tools'.
    await expect(page.getByText(/only clears/)).toBeVisible();
    await expect(page.getByText(/are never touched/)).toBeVisible();
    await page.getByRole('button', { name: 'Preview what would be removed' }).click();
    await expect(page.getByText(/prompt texts/)).toBeVisible();

    const confirm = page.getByLabel('Type DELETE to confirm');
    await expect(confirm).toBeVisible();
    const button = page.getByRole('button', { name: /^Delete prompt text$/ });
    await expect(button).toBeDisabled();

    await confirm.fill('DELETE');
    await expect(button).toBeEnabled();
  });

  test('the JSON export contains exactly what the database holds', async ({ request }) => {
    const overview = (await (
      await request.get('/api/analytics/overview?range=all&timezone=UTC')
    ).json()) as { totals: { events: number; prompts: number } };

    const response = await request.get('/api/data/export?range=all&format=json&timezone=UTC');
    expect(response.ok()).toBe(true);
    const body = (await response.json()) as {
      events: Array<{ eventType: string; promptText: string | null }>;
      manifest: { formatVersion: number };
    };

    expect(body.manifest.formatVersion).toBe(1);
    expect(body.events.length).toBe(overview.totals.events);
    expect(body.events.filter((e) => e.eventType === 'prompt').length).toBe(
      overview.totals.prompts,
    );
    expect(body.events.length).toBeGreaterThanOrEqual(TOTAL_PROMPTS * 2);
    expect(body.events.some((e) => e.promptText?.includes('docker swarm'))).toBe(true);
  });

  test('the dark theme applies without reloading', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Switch to dark theme/ }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('the layout stays usable on a narrow screen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/?range=30d');
    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

test.describe('errors and accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await completeOnboarding(page);
  });

  test('a failing request produces a sentence, not a stack trace', async ({ page }) => {
    await page.route('**/api/analytics/overview*', (route) => route.abort('failed'));
    await page.goto('/');
    await expect(page.getByText('The local analytics service is unavailable')).toBeVisible();
    await expect(page.getByRole('button', { name: 'View technical details' })).toBeVisible();
    await expect(page.getByText(/ECONNREFUSED/)).toHaveCount(0);
  });

  test.describe('axe', () => {
    for (const path of ['/', '/activity', '/prompts', '/projects', '/insights', '/settings']) {
      test(`${path} has no critical or serious violations`, async ({ page }) => {
        await page.goto(path === '/' ? '/?range=30d' : `${path}?range=30d`);
        await page.waitForLoadState('networkidle');
        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze();
        const blocking = results.violations.filter(
          (violation) => violation.impact === 'critical' || violation.impact === 'serious',
        );
        expect(
          blocking.map((v) => `${v.id}: ${v.nodes.length} node(s) — ${v.help}`),
          'accessibility violations',
        ).toEqual([]);
      });
    }
  });
});

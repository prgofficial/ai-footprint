import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Circle, Footprints, Moon, Sun } from 'lucide-react';
import { useHealth, useSystemConfig } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { APP_NAME, VENDOR_NAME, VENDOR_SHORT, VENDOR_URL } from '@ai-footprint/shared';
import { Button } from '../ui/primitives';

/**
 * Eight sections, each answering a question none of the others does: how much (Overview), what
 * ran (Sessions), where (Projects), what you asked (Prompts), the raw record (Activity), what it
 * all means (Insights). A ninth restated the sixth in a second layout and has gone.
 */
const NAV = [
  { to: '/', label: 'Overview', end: true },
  { to: '/sessions', label: 'Sessions' },
  { to: '/projects', label: 'Projects' },
  { to: '/prompts', label: 'Prompts' },
  { to: '/activity', label: 'Activity' },
  { to: '/insights', label: 'Insights' },
  { to: '/connections', label: 'Connections' },
  { to: '/settings', label: 'Settings' },
];

type Theme = 'light' | 'dark' | 'system';

function useTheme(): [Theme, (theme: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return (localStorage.getItem('ai-footprint-theme') as Theme) ?? 'system';
    } catch {
      return 'system';
    }
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('ai-footprint-theme', theme);
    } catch {
      // A viewer with site data blocked simply keeps the system theme.
    }
  }, [theme]);

  return [theme, setTheme];
}

/**
 * A mark, not a line of text: the glyph carries the product and the byline sits under the name
 * where a maker's mark belongs, rather than competing with the navigation beside it.
 */
function Wordmark() {
  return (
    <span className="flex items-center gap-2.5">
      <span
        className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent/12 text-accent ring-1 ring-accent/25"
        aria-hidden="true"
      >
        <Footprints className="size-4" />
      </span>
      <span className="flex flex-col leading-none">
        <span className="text-sm font-semibold tracking-tight text-ink">{APP_NAME}</span>
        <span className="mt-1 text-[0.625rem] leading-none font-medium tracking-[0.08em] text-subtle uppercase">
          by {VENDOR_SHORT}
        </span>
      </span>
    </span>
  );
}

export function AppShell() {
  const health = useHealth();
  const config = useSystemConfig();
  const [theme, setTheme] = useTheme();
  const location = useLocation();

  const offline = health.isError;

  useEffect(() => {
    const title = NAV.find((item) => item.to === location.pathname)?.label;
    document.title = title ? `${title} · AI Footprint` : 'AI Footprint';
  }, [location.pathname]);

  return (
    <div className="flex min-h-full flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-raised focus:px-3 focus:py-2 focus:text-sm"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-30 border-b border-line bg-surface/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-[1440px] items-center gap-5 px-5 sm:px-8">
          <NavLink
            to="/"
            className="shrink-0 rounded-lg transition-opacity hover:opacity-85"
            aria-label={`${APP_NAME} home`}
          >
            <Wordmark />
          </NavLink>

          <span className="hidden h-7 w-px shrink-0 bg-line md:block" aria-hidden="true" />

          {/* One inset rail so the sections read as a set, and the active one as a raised card. */}
          <nav
            aria-label="Primary"
            className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto rounded-lg bg-sunken/60 p-1"
          >
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    'rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-all',
                    isActive
                      ? 'bg-raised text-ink shadow-card ring-1 ring-line'
                      : 'text-subtle hover:bg-raised/60 hover:text-ink',
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="flex shrink-0 items-center gap-2">
            {offline ? (
              <span
                className="flex items-center gap-1.5 rounded-full bg-negative/10 px-2 py-1 text-2xs font-medium text-negative"
                role="status"
              >
                <Circle className="size-2 fill-current" aria-hidden="true" />
                Disconnected
              </span>
            ) : (
              <span
                className="hidden items-center gap-1.5 rounded-full bg-positive/10 px-2 py-1 text-2xs font-medium text-positive lg:flex"
                role="status"
              >
                <Circle className="size-2 fill-current" aria-hidden="true" />
                Local
              </span>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="size-8 rounded-lg border border-line px-0 hover:bg-sunken"
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            >
              {theme === 'dark' ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
            </Button>
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-[1440px] flex-1 px-5 py-8 sm:px-8">
        <Outlet />
      </main>

      <footer className="border-t border-line px-5 py-4 sm:px-8">
        <div className="mx-auto flex w-full max-w-[1440px] flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-subtle">
          <span>Everything stays on this machine.</span>
          {config.data ? (
            <span className="font-mono">
              {config.data.hostDataDirectory ?? config.data.dataDirectory}
            </span>
          ) : null}
          <span className="ml-auto flex items-center gap-3">
            <span>
              Built by{' '}
              <a
                href={VENDOR_URL}
                target="_blank"
                rel="noreferrer noopener"
                className="font-medium text-muted underline-offset-2 transition-colors hover:text-accent hover:underline"
              >
                {VENDOR_NAME}
              </a>
            </span>
            {config.data ? <span>v{config.data.version}</span> : null}
          </span>
        </div>
      </footer>
    </div>
  );
}

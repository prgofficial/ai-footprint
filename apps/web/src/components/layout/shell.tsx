import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Circle, Moon, Sun } from 'lucide-react';
import { useHealth, useSystemConfig } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { Button } from '../ui/primitives';

const NAV = [
  { to: '/', label: 'Overview', end: true },
  { to: '/activity', label: 'Activity' },
  { to: '/prompts', label: 'Prompts' },
  { to: '/projects', label: 'Projects' },
  { to: '/sessions', label: 'Sessions' },
  { to: '/insights', label: 'Insights' },
  { to: '/profile', label: 'Profile' },
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

function Wordmark() {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-sm font-semibold tracking-tight text-ink">AI Footprint</span>
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

      <header className="sticky top-0 z-30 border-b border-line bg-surface/85 backdrop-blur-sm">
        <div className="mx-auto flex h-14 w-full max-w-[1440px] items-center gap-6 px-5 sm:px-8">
          <NavLink to="/" className="shrink-0 rounded-sm" aria-label="AI Footprint home">
            <Wordmark />
          </NavLink>

          <nav
            aria-label="Primary"
            className="-mx-1 flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto"
          >
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    'rounded-md px-2.5 py-1.5 text-xs font-medium whitespace-nowrap transition-colors',
                    isActive ? 'bg-sunken text-ink' : 'text-subtle hover:text-ink',
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="flex shrink-0 items-center gap-2">
            {offline ? (
              <span className="flex items-center gap-1.5 text-2xs text-negative" role="status">
                <Circle className="size-2 fill-current" aria-hidden="true" />
                Disconnected
              </span>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
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
            <>
              <span className="font-mono">
                {config.data.hostDataDirectory ?? config.data.dataDirectory}
              </span>
              <span className="ml-auto">v{config.data.version}</span>
            </>
          ) : null}
        </div>
      </footer>
    </div>
  );
}

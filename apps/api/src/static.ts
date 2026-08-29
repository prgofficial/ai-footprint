import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { APP_NAME } from '@ai-footprint/shared';

const CANDIDATES = ['../../web/dist', '../../../web/dist', '../../../apps/web/dist', './public'];

export function resolveWebRoot(explicit?: string): string | null {
  if (explicit && existsSync(join(explicit, 'index.html'))) return resolve(explicit);
  for (const candidate of CANDIDATES) {
    const dir = resolve(__dirname, candidate);
    if (existsSync(join(dir, 'index.html'))) return dir;
  }
  return null;
}

const MISSING_BUILD_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${APP_NAME}</title>
<style>
 :root{color-scheme:light dark}
 body{margin:0;min-height:100vh;display:grid;place-items:center;
   font:15px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
   background:#fafaf9;color:#1c1917}
 @media(prefers-color-scheme:dark){body{background:#0c0a09;color:#e7e5e4}}
 main{max-width:34rem;padding:2rem}
 h1{font-size:1.25rem;font-weight:600;letter-spacing:-.01em;margin:0 0 .5rem}
 p{margin:0 0 1rem;opacity:.75}
 code{font:13px ui-monospace,SFMono-Regular,Menlo,monospace;background:rgba(120,113,108,.16);
   padding:.15rem .4rem;border-radius:.3rem}
</style></head>
<body><main>
<h1>The ${APP_NAME} interface has not been built yet</h1>
<p>The API is running. Build the web application, then reload this page.</p>
<p><code>npm run build</code></p>
</main></body></html>`;

/**
 * Plan §2.3: one origin. `/api/*` is the API and everything else falls through to the SPA,
 * which removes CORS, the bootstrap round-trip and the second container in one move.
 */
export function mountStaticSpa(app: Express, webRoot: string | null): void {
  if (!webRoot) {
    app.get(/^(?!\/api\/).*/, (_request: Request, response: Response) => {
      response.status(200).type('html').send(MISSING_BUILD_PAGE);
    });
    return;
  }

  app.use(
    express.static(webRoot, {
      index: false,
      etag: true,
      maxAge: '1h',
      setHeaders: (response, path) => {
        if (path.includes('/assets/')) {
          response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    }),
  );

  app.get(/^(?!\/api\/).*/, (request: Request, response: Response, next: NextFunction) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') return next();
    response.sendFile(join(webRoot, 'index.html'), (error) => {
      if (error) next(error);
    });
  });
}

import type { UserFacingError } from '@ai-footprint/shared';

/**
 * The API is same-origin (plan §2.3), so there is no base URL to discover and no CORS to
 * negotiate. Every failure is turned into the error shape the UI knows how to render.
 */
export class ApiError extends Error {
  readonly title: string;
  readonly details?: string;
  readonly status: number;

  constructor(payload: UserFacingError) {
    super(payload.message);
    this.name = 'ApiError';
    this.title = payload.title;
    this.details = payload.details;
    this.status = payload.statusCode;
  }
}

const OFFLINE: UserFacingError = {
  title: 'The local analytics service is unavailable',
  message: 'AI Footprint is not responding. Try restarting it from the terminal you started it in.',
  statusCode: 0,
};

async function toError(response: Response): Promise<ApiError> {
  try {
    const body = (await response.json()) as UserFacingError;
    if (body && typeof body.message === 'string') return new ApiError(body);
  } catch {
    // Fall through to the generic shape below.
  }
  return new ApiError({
    title: 'That request failed',
    message: 'AI Footprint could not complete that request.',
    statusCode: response.status,
  });
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError(OFFLINE);
  }
  if (!response.ok) throw await toError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function apiGet<T>(
  path: string,
  params?: Record<string, string | number | undefined>,
): Promise<T> {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined || value === '' || value === null) continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return request<T>(`${path}${query ? `?${query}` : ''}`);
}

export function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function apiPatch<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
}

export function downloadUrl(
  path: string,
  params: Record<string, string | number | undefined>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    search.set(key, String(value));
  }
  return `${path}?${search.toString()}`;
}

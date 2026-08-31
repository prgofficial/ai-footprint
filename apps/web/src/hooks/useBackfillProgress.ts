import { useEffect, useState } from 'react';
import type { BackfillProgress } from '@ai-footprint/shared';

/**
 * Server-sent events, so a multi-gigabyte import shows real movement without the UI
 * polling. Falls silent rather than erroring if the stream cannot be opened.
 */
export function useBackfillProgress(providerId: string | null): BackfillProgress | null {
  const [progress, setProgress] = useState<BackfillProgress | null>(null);

  useEffect(() => {
    if (!providerId) {
      setProgress(null);
      return;
    }

    let source: EventSource | null = null;
    try {
      source = new EventSource(`/api/providers/${providerId}/progress`);
    } catch {
      return;
    }

    source.onmessage = (event) => {
      try {
        setProgress(JSON.parse(event.data) as BackfillProgress);
      } catch {
        // A malformed frame is skipped; the next one carries the same state.
      }
    };
    source.onerror = () => source?.close();

    return () => source?.close();
  }, [providerId]);

  return progress;
}

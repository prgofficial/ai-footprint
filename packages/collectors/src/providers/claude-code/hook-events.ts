import type { AIEventInput, EventType, HookPayload } from '@ai-footprint/shared';
import { PRODUCT_NAME, PROVIDER_ID } from './mappers';

const EVENT_TYPE_BY_HOOK: Record<string, EventType> = {
  SessionStart: 'session_start',
  SessionEnd: 'session_end',
  PreCompact: 'compaction',
  PostCompact: 'compaction',
  Notification: 'notification',
};

/**
 * Tier B. Hooks carry no tokens, model or cost, so they exist to mark session lifecycle and
 * to tell the watcher that something just happened, never as the source of usage numbers.
 */
export function mapHookPayload(payload: HookPayload, receivedAt = new Date()): AIEventInput | null {
  const eventType = EVENT_TYPE_BY_HOOK[payload.hook_event_name];
  if (!eventType) return null;

  return {
    providerId: PROVIDER_ID,
    product: PRODUCT_NAME,
    externalId: `hook:${payload.hook_event_name}:${payload.session_id ?? 'unknown'}:${receivedAt.toISOString()}`,
    eventType,
    timestamp: receivedAt.toISOString(),
    sessionId: payload.session_id ?? null,
    isSubagent: Boolean(payload.agent_id),
    workingDirectory: payload.cwd ?? null,
    model: payload.model ?? null,
    metadata: {
      hookEvent: payload.hook_event_name,
      reason: payload.reason,
      permissionMode: payload.permission_mode,
      agentType: payload.agent_type,
      source: 'hook',
    },
  };
}

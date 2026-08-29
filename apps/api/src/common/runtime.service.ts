import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import {
  appVersion,
  currentPlatform,
  ensureAppDirectories,
  getAppPaths,
  isDockerRuntime,
  markRuntimeStopped,
  resolveTimezone,
  type AppPaths,
} from '@ai-footprint/config';

export interface RuntimeState {
  port: number;
  host: string;
  ingestToken: string;
  mode: 'native' | 'docker';
  startedAt: number;
}

/** Single source of truth for paths, port, token and mode across every module. */
@Injectable()
export class RuntimeService implements OnApplicationShutdown {
  readonly paths: AppPaths;
  readonly version = appVersion();
  readonly platform = currentPlatform();
  private state: RuntimeState;

  constructor() {
    this.paths = ensureAppDirectories(getAppPaths());
    this.state = {
      port: 0,
      host: '127.0.0.1',
      ingestToken: '',
      mode: isDockerRuntime() ? 'docker' : 'native',
      startedAt: Date.now(),
    };
  }

  configure(patch: Partial<RuntimeState>): void {
    this.state = { ...this.state, ...patch };
  }

  get port(): number {
    return this.state.port;
  }

  get host(): string {
    return this.state.host;
  }

  get ingestToken(): string {
    return this.state.ingestToken;
  }

  get mode(): 'native' | 'docker' {
    return this.state.mode;
  }

  get uptimeMs(): number {
    return Date.now() - this.state.startedAt;
  }

  get url(): string {
    return `http://localhost:${this.state.port}`;
  }

  timezoneFallback(): string {
    return resolveTimezone();
  }

  onApplicationShutdown(): void {
    if (this.state.port > 0) markRuntimeStopped(this.paths);
  }
}

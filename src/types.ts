import type { LRUCache } from 'lru-cache';

export type CacheFnArguments = {
  key?: string;
  namespace: string;
  options?: LRUCache.GetOptions<string, {}, null> | LRUCache.SetOptions<string, {}, null>;
  value?: NonNullable<unknown>;
};

export type Methods = 'clear' | 'delete' | 'get' | 'set';

export type Request = {
  args: CacheFnArguments;
  clientId: string;
  operation: Methods;
  requestId: string;
  sourceId: string;
};

export type Reply = {
  clientId: string;
  data?: unknown;
  error?: unknown;
  requestId: string;
  sourceId: string;
};

export type GetOverrides = {
  allowStale: boolean;
  updateAgeOnGet: boolean;
};

export type SetOverrides = {
  size: number;
  ttl: number;
};

export type OverridesUnion = GetOverrides | SetOverrides;

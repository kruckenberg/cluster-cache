import { LRUCache } from 'lru-cache';

export type CacheMethods = 'clear' | 'delete' | 'get' | 'set';

export type NonNullLRUCache = NonNullable<LRUCache<string, NonNullable<unknown>, unknown>>;

export type ClusterCacheReply = {
  clientId: string;
  data: unknown;
  error: unknown;
  requestId: string;
  sourceId: string;
};

export type ClusterCacheRequest = {
  args: {
    key?: string;
    namespace: string;
    value: NonNullable<unknown>;
  };
  clientId: string;
  operation: CacheMethods;
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

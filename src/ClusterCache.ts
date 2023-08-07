import cluster from 'node:cluster';
import { LRUCache } from 'lru-cache';

import type { Worker } from 'node:cluster';
import type * as Types from './types.js';

/**
 * Creates a singleton that wraps an LRU cache accessible to worker processes through IPC messaging.
 */
export class ClusterCache {
  private static instance: ClusterCache;

  private readonly cache!: LRUCache<string, NonNullable<unknown>, null>;

  readonly logger!: Console;

  readonly options!: LRUCache.Options<string, {}, null>;

  readonly sourceId = 'cluster-cache';

  constructor(options: LRUCache.Options<string, NonNullable<unknown>, null>, logger = console) {
    if (ClusterCache.instance) {
      return ClusterCache.instance;
    }

    if (!cluster.isPrimary) {
      throw new Error('A shared cache may only be initialized on the primary process.');
    }

    this.options = options;
    this.logger = logger;
    this.cache = new LRUCache(options);

    cluster.on('message', this.handleRequest);

    ClusterCache.instance = this;
  }

  /**
   * Namespaces cache key.
   */
  private applyNamespace = (namespace: string, key: string = ''): string => {
    return `${namespace}:${key}`;
  };

  /**
   * Maps operations to cache methods.
   */
  private getCacheFn = (operation: Types.Methods) => {
    switch (operation) {
      case 'clear':
        return this.clear;
      case 'delete':
        return this.delete;
      case 'get':
        return this.get;
      case 'set':
        return this.set;
      default:
        throw new TypeError(`'${operation}' is not a recognized cluster cache operation.`);
    }
  };

  /**
   * Inspects incoming requests, chooses and executes appropriate cache method, and replies
   * with the method's result.
   */
  private handleRequest = (worker: Worker, request: Types.Request) => {
    const { args, clientId, requestId, operation, sourceId } = request;

    const cacheFn = this.getCacheFn(operation);

    try {
      const data = cacheFn(args);
      this.reply(worker, { clientId, data, requestId, sourceId });
    } catch (error) {
      this.reply(worker, { clientId, error, requestId, sourceId });
    }
  };

  /**
   * Sends response to the requesting worker.
   */
  private reply = (worker: Worker, reply: Types.Reply): void => {
    worker.send(reply);
  };

  /**
   * Clears all keys belonging to a namespace.
   */
  clear = ({ namespace }: Types.CacheFnArguments) => {
    this.cache.forEach((_, key, cache) => {
      if (key.startsWith(this.applyNamespace(namespace, ''))) {
        cache.delete(key);
      }
    });

    return 'OK';
  };

  /**
   * Deletes a namespaced key from the cache.
   */
  delete = ({ key, namespace }: Types.CacheFnArguments) => {
    this.cache.delete(this.applyNamespace(namespace, key));

    return 'OK';
  };

  /**
   * Retrieves value cached at namespaced key.
   */
  get = ({ key, namespace, options }: Types.CacheFnArguments) => {
    return this.cache.get(this.applyNamespace(namespace, key), options);
  };

  /**
   * Caches a value at namespaced key.
   */
  set = ({ key, namespace, options, value }: Types.CacheFnArguments) => {
    try {
      this.cache.set(this.applyNamespace(namespace, key), value, options);

      return 'OK';
    } catch (error) {
      throw new Error(
        `Failed to cache value for key ${this.applyNamespace(namespace, key)}: ${error}`,
      );
    }
  };
}

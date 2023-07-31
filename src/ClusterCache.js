import cluster from 'node:cluster';
import { LRUCache } from 'lru-cache';

export class ClusterCache {
  /**
   * @type {ClusterCache}
   */
  static #instance;

  defaultCacheConfig = {
    allowStale: false,
    max: 500,
    ttl: 300_000, // 5 minutes, in milliseconds
    updateAgeOnGet: true,
  };

  sourceId = 'cluster-cache';

  constructor(options = {}) {
    if (ClusterCache.#instance) {
      return ClusterCache.#instance;
    }

    if (!cluster.isPrimary) {
      throw new Error('A shared cache may only be initialized on the primary process.');
    }

    /**
     * @type {import('./clusterCache.d.ts').NonNullLRUCache}
     */
    this.cache = new LRUCache({ ...this.defaultCacheConfig, ...options });

    cluster.on('message', this.#handleRequest);

    ClusterCache.#instance = this;
  }

  /**
   * Namespaces cache key to avoid key collisions.
   *
   * @param {string}  namespace
   * @param {string}  [key]
   * @returns {string}
   */
  #applyNamespace = (namespace, key) => {
    return `${namespace}:${key || ''}`;
  };

  /**
   * Maps operations to cache methods.
   *
   * @param {import('./clusterCache.d.ts').CacheMethods} operation
   * @returns {Function}
   * @throws {TypeError}
   */
  #getCacheFunction = (operation) => {
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
   *
   * @param {import('node:cluster').Worker} worker
   * @param {import('./clusterCache.d.ts').ClusterCacheRequest} request
   */
  #handleRequest = async (worker, request) => {
    const { args, clientId, requestId, operation, sourceId } = request;

    const cacheFn = this.#getCacheFunction(operation);

    try {
      const data = await cacheFn(args);
      this.#reply(worker, { clientId, data, requestId, sourceId });
    } catch (error) {
      this.#reply(worker, { clientId, error, requestId, sourceId });
    }
  };

  /**
   * Sends response to the requesting worker.
   *
   * @param {import('node:cluster').Worker}  worker
   * @param {object}  response
   * @returns {void}
   */
  #reply = (worker, response) => {
    worker.send(response);
  };

  /**
   * Clears all keys belonging to a namespace.
   *
   * @param {object}  args
   * @param {string}  args.namespace
   * @returns {'OK'}
   */
  clear = ({ namespace }) => {
    this.cache.forEach((_, key, cache) => {
      if (key.startsWith(this.#applyNamespace(namespace, ''))) {
        cache.delete(key);
      }
    });

    return 'OK';
  };

  /**
   * Deletes a namespaced key from the cache.
   *
   * @param {object}  args
   * @param {string}  args.key
   * @param {string}  args.namespace
   * @returns {'OK'}
   *
   */
  delete = ({ key, namespace }) => {
    this.cache.delete(this.#applyNamespace(namespace, key));

    return 'OK';
  };

  /**
   * Retrieves value cached at namespaced key.
   *
   * @param {object}  args
   * @param {string}  args.key
   * @param {string}  args.namespace
   * @param {object}  [args.options]
   * @returns {unknown | undefined}
   */
  get = ({ key, namespace, options }) => {
    return this.cache.get(this.#applyNamespace(namespace, key), options);
  };

  /**
   * Caches a value at namespaced key.
   *
   * @param {object}  args
   * @param {string}  args.key
   * @param {string}  args.namespace
   * @param {object}  [args.options]
   * @param {NonNullable<unknown>} args.value
   * @returns {'OK'}
   */
  set = ({ key, namespace, options, value }) => {
    try {
      this.cache.set(this.#applyNamespace(namespace, key), value, options);

      return 'OK';
    } catch (error) {
      throw new Error(
        `Failed to cache value for key ${this.#applyNamespace(namespace, key)}: ${error}`,
      );
    }
  };
}

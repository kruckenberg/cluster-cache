import cluster from 'node:cluster';
import console from 'node:console';
import process from 'node:process';
import merge from 'lodash/merge.js';
import { v4 as generateId } from 'uuid';

export class ClusterCacheClient {
  static defaultConfig = {
    allowOverrides: false,
    logger: console,
    namespace: '',
    requestTimeout: 300, // in milliseconds
    requestOptions: {
      allowStale: false,
      ttl: 300_000, // 5 minutes, in milliseconds
      updateAgeOnGet: true,
    },
    updateAgeOnGet: true,
  };

  /**
   * @type {Record<string, (reply: import('./clusterCache.d.ts').ClusterCacheReply) => void>}
   */
  pendingRequests = {};

  sourceId = 'cluster-cache';

  constructor(config = {}) {
    if (cluster.isPrimary) {
      throw new Error(
        "Cluster cache client may not be initialized in the cluster's primary process.",
      );
    }

    this.clientId = generateId();
    this.config = merge(ClusterCacheClient.defaultConfig, config);
    this.logger = this.config.logger;
    this.namespace = this.config.namespace || this.clientId;

    process.on('message', this.#handleReply);
  }

  /**
   * Adds override options if provided and permitted.
   *
   * @param {object}  args
   * @param {string}  [args.key]
   * @param {string}  args.namespace
   * @param {unknown} [args.value]
   * @param {import('./clusterCache.d.ts').OverridesUnion}  [overrides]
   */
  #addRequestOptions = (args, overrides) => {
    if (overrides && !this.config.allowOverrides) {
      this.logger.warn(
        `Overrides not applied because cluster cache client not configured to allow per-operation overrides.`,
      );

      return args;
    }

    return {
      ...args,
      options: merge(this.config.requestOptions, overrides),
    };
  };

  /**
   * Sends a request to clear a namespace from the cluster cache.
   *
   * @async
   */
  clear = async () => {
    const baseArgs = { namespace: this.namespace };
    return this.#request('clear', baseArgs);
  };

  /**
   * Sends a request to delete a namespaced key from the cluster cache.
   *
   * @async
   * @param {string} key
   */
  delete = async (key) => {
    const baseArgs = { key, namespace: this.namespace };
    return this.#request('delete', baseArgs);
  };

  /**
   * Sends a request to get a namespaced key from the cluster cache.
   *
   * @async
   * @param {string} key
   * @param {import('./clusterCache.d.ts').GetOverrides} [overrides]
   */
  get = async (key, overrides) => {
    const baseArgs = { key, namespace: this.namespace };
    return this.#request('get', this.#addRequestOptions(baseArgs, overrides));
  };

  /**
   * Handles replies from cluster's primary process. If the reply matches a pending
   * request, resolve or reject the associated promise and remove it from the
   * pending request map.
   *
   * @param {import('./clusterCache.d.ts').ClusterCacheReply} reply
   */
  #handleReply = (reply) => {
    const { clientId, requestId, sourceId } = reply;

    if (
      sourceId === this.sourceId &&
      clientId === this.clientId &&
      this.pendingRequests[requestId]
    ) {
      this.pendingRequests[requestId](reply);
      delete this.pendingRequests[requestId];
    }
  };

  /**
   * Requests a cache operation to be performed on the primary process. Creates a promise
   * that will be resolved or rejected when the primary process responds.
   *
   * A configurable failsafe timeout is set, causing the request's promise to be rejected
   * if a response has not been received within the permitted time.
   *
   * @param {import('./clusterCache.d.ts').CacheMethods} operation
   * @param {object}  args
   * @param {string}  [args.key]
   * @param {string}  args.namespace
   * @param {unknown} [args.value]
   * @param {object}  [args.options]
   * @param {boolean} [args.options.allowStale]
   * @param {number}  [args.options.ttl]
   * @param {boolean} [args.options.updateAgeOnGet]
   */
  #request = (operation, args) => {
    return new Promise((resolve, reject) => {
      const requestId = generateId();

      const message = {
        args,
        clientId: this.clientId,
        operation,
        requestId,
        sourceId: this.sourceId,
      };

      const failsafeTimeout = setTimeout(() => {
        return reject(
          new Error(
            `Cluster cache ${operation} request timed out: request ID ${requestId}, client ID ${this.clientId}.`,
          ),
        );
      }, this.config.requestTimeout);

      this.pendingRequests[requestId] = (response) => {
        clearTimeout(failsafeTimeout);
        return response.error ? reject(response.error) : resolve(response.data);
      };

      if (process.send) {
        process.send(message);
      }
    });
  };

  /**
   * Sends a request to add a namespaced key-value pair to the cluster cache.
   *
   * @async
   * @param {string} key
   * @param {unknown} value
   * @param {import('./clusterCache.d.ts').SetOverrides} [overrides]
   */
  set = async (key, value, overrides) => {
    const baseArgs = { key, namespace: this.namespace, value };
    return this.#request('set', this.#addRequestOptions(baseArgs, overrides));
  };
}

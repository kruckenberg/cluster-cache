import cluster from 'node:cluster';
import process from 'node:process';
import merge from 'lodash/merge.js';
import { v4 as generateId } from 'uuid';

import * as Types from './types.js';

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

  readonly clientId!: string;

  readonly config;

  readonly logger: Console;

  readonly namespace: string;

  private readonly pendingRequests: Record<string, (reply: Types.Reply) => unknown> = {};

  readonly sourceId = 'cluster-cache';

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

    process.on('message', this.handleReply);
  }

  /**
   * Adds override options if provided and permitted.
   */
  private addRequestOptions = (args: Types.CacheFnArguments, overrides: Types.OverridesUnion) => {
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
   */
  clear = async () => {
    const baseArgs = { namespace: this.namespace };
    return this.request('clear', baseArgs);
  };

  /**
   * Sends a request to delete a namespaced key from the cluster cache.
   */
  delete = async (key: string) => {
    const baseArgs = { key, namespace: this.namespace };
    return this.request('delete', baseArgs);
  };

  /**
   * Sends a request to get a namespaced key from the cluster cache.
   */
  get = async (key: string, overrides: Types.GetOverrides) => {
    const baseArgs = { key, namespace: this.namespace };
    return this.request('get', this.addRequestOptions(baseArgs, overrides));
  };

  /**
   * Handles replies from cluster's primary process. If the reply matches a pending
   * request, resolve or reject the associated promise and remove it from the
   * pending request map.
   */
  private handleReply = (reply: Types.Reply) => {
    const { clientId, requestId, sourceId } = reply;

    if (
      sourceId === this.sourceId &&
      clientId === this.clientId &&
      Object.hasOwn(this.pendingRequests, requestId)
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
   */
  private request = (operation: Types.Methods, args: Types.CacheFnArguments) => {
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

      this.pendingRequests[requestId] = (reply) => {
        clearTimeout(failsafeTimeout);
        return reply.error ? reject(reply.error) : resolve(reply.data);
      };

      if (process.send) {
        process.send(message);
      }
    });
  };

  /**
   * Sends a request to add a namespaced key-value pair to the cluster cache.
   */
  set = async (key: string, value: NonNullable<unknown>, overrides: Types.SetOverrides) => {
    const baseArgs = { key, namespace: this.namespace, value };
    return this.request('set', this.addRequestOptions(baseArgs, overrides));
  };
}

# cluster-cache
Share a centralized [LRU cache](https://www.npmjs.com/package/lru-cache) among clustered Node.js workers.


## Use
Instantiate and configure the cluster cache from the main process:

```javascript
import cluster from 'node:cluster';
import { availableParallelism } from 'node:os';
import { ClusterCache } from '@kruckenberg/cluster-cache';

const numCPUs = availableParallelism();

if (cluster.isPrimary) {
  const clusterCache = new ClusterCache({ max: 5000, ttl: 300_000 });

  cluster.setupPrimary({
    exec: 'path/to/workerScript.js',
  });

  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }
}
```

Access the centralized cache by instantiating a client:

```javascript
import { ClusterCacheClient } from '@kruckenberg/cluster-cache';

const userCache = new ClusterCacheClient({ namespace: 'users', ttl: 60_000 });

async function getUser(userId) {
  const cachedUser = await userCache.get(userId);

  if (!cachedUser) {
    const fetchedUser = await userFetchingFunction(userId);
    userCache.set(userId, fetchedUser);

    return fetchedUser;
  }

  return cachedUser;
}
```


## Configuring the Cache
When instantiating the cache, pass [options](https://github.com/isaacs/node-lru-cache#options) to configure the cache. You must provide at least one of `max`, `maxSize`, or `ttl`.

## Configuring the Cache client
On workers, you can create one or more clients. 

### Configuration Options:
  - `namespace: string`: Clients that share a `namespace` can read from or write to the same namespace on the central cache. (If not configured, the `namespace` will default to a unique ID, making the client's namespace private).

  - `allowOverrides: boolean = false`: Honor per-request options (like `ttl`) when cache methods are invoked.
  
  - `logger: Console = console`: defaults to Node's native `console` global, but you can pass your own logging function as long as it exposes the same methods.

  - `requestTimeout: number = 300`: In milliseconds, the time the client will wait for a response from the primary process. If a response is not received, the request will error.

  - `requestOptions`: Values that will be used (unless overridden) when making `get` and `set` requests. 
    - `allowStale: boolean = false`: Return the value of an expired key before purging it.

    - `ttl: number = 300_000`: In milliseconds, the valid lifetime of the cache entry. `lru-cache` will not purge unaccessed expired entries unless configured to do so.

    - `updateAgeOnGet: boolean = true`: If true, extends the lifetime of the cache entry when that entry is read.

# cluster-cache
Share a centralized cache among clustered Node.js workers.

## Use
Instantiate and configure the cluster cache from the main process:

```javascript
import cluster from 'node:cluster';
import { availableParallelism } from 'node:os';
import { ClusterCache } from '@kruckenberg/cluster-cache`;

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

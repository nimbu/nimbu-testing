# @nimbu/testing

A set of utilities useful for testing [Nimbu](https://www.nimbu.io) Cloud Code and the Nimbu JS SDK

## Install

```sh
$ npm install @nimbu/testing --save-dev
```

or

```
$ yarn add -D @nimbu/testing
```

or

```sh
$ pnpm add -D @nimbu/testing
```

## Usage

### Runtime setup

```ts
import { setup, Nimbu } from '@nimbu/testing'

beforeEach(async () => {
  await setup({
    fixtures: {
      orders: [{ id: 'order-1', status: 'paid' }],
    },
    siteEnv: {
      MOLLIE_KEY: 'test-key',
    },
  })
})
```

`setup()` resets the Cloud Code registry, schedules, in-memory SDK store, API mocks, module mocks, and current request context. It also installs `global.Nimbu`.

### Promise-native v1

`@nimbu/testing` v1 targets the Promise-native `nimbu-js-sdk` API. Deprecated `Nimbu.Future` helpers are intentionally not provided.

```ts
// old Cloud Code
Nimbu.Future.as(value)
Nimbu.Future.error(error)
Nimbu.Future.when(promises)

// v1 tests and migrated Cloud Code
Promise.resolve(value)
Promise.reject(error)
Promise.all(promises)
```

### Running Cloud Code handlers

```ts
import { runCloudFunction, runJob, runRoute, runCallback, EventType } from '@nimbu/testing'

Nimbu.Cloud.define('calculate_totals', async (request, response) => {
  return response.success({ total: request.params.total })
})

await expect(runCloudFunction('calculate_totals', { params: { total: 42 } })).resolves.toEqual({
  result: { total: 42 },
  message: 'Running Cloud Function failed',
  error: false,
  status: undefined,
})
```

Runner helpers use the registered Cloud Code handler and return the same payload shape the Rails runners expose for functions, jobs, callbacks, routes, and extensions.

### SDK fixtures and queries

```ts
import { mockQueryResults } from '@nimbu/testing'

const {
  orders: [ordersQuery],
} = mockQueryResults({
  orders: [
    { id: 'order-1', status: 'draft' },
    { id: 'order-2', status: 'paid' },
  ],
})

const paid = await Nimbu.Query('orders').equalTo('status', 'paid').first()

expect(paid.id).toBe('order-2')
expect(ordersQuery.equalTo).toHaveBeenCalledWith('status', 'paid')
```

The in-memory store supports common project test patterns: `first`, `find`, `findAll`, `get`, `count`, `findDeleted`, `eachBatch`, and `collection().fetch()`.

### API and module mocks

```ts
import { mockNimbuAPI, mockModule } from '@nimbu/testing'

mockNimbuAPI()
await Nimbu.API.get('/channels/orders/entries')

mockModule('soap', {
  client: () => ({
    call: async () => ({ ok: true }),
  }),
})
```

Use `mockAPI` directly when a test needs low-level URL assertions. Use `mockNimbuAPI()` when SDK calls should be served from the in-memory fixture store.

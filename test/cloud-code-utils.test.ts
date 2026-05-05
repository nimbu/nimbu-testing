import Nimbu from '../src/js-sdk-utils'
import {
  CloudCodeHandleType,
  EventType,
  ViewType,
  getAfterCallbackHandler,
  getBeforeCallbackHandler,
  getCloudFunctionHandler,
  getExtendHandler,
  getJobHandler,
  getRouteHandler,
  mockRequest,
  runCallback,
  runCloudFunction,
  runExtension,
  runJob,
  runRoute,
  setup,
} from '../src'

describe('cloud code handler lookup helpers', () => {
  beforeEach(async () => {
    await setup()
  })

  test('finds route handlers registered for specific HTTP verbs', () => {
    const handler = jest.fn()

    Nimbu.Cloud.get('/health', handler)

    expect(getRouteHandler('get', '/health')).toBe(handler)
  })

  test('finds routes registered through Nimbu.Cloud.route with constraints', () => {
    const handler = jest.fn()

    Nimbu.Cloud.route('GET', '/orders/:id', { id: /\d+/ }, handler)

    expect(getRouteHandler('GET', '/orders/:id')).toBe(handler)
    expect(Nimbu.Cloud.internal.handlers.routes[0]).toMatchObject({
      verb: 'GET',
      path: '/orders/:id',
      constraints: { id: /\d+/ },
      order: 0,
      handler,
    })
  })

  test('finds callback, job, function, and extension handlers by spec', () => {
    const beforeHandler = jest.fn()
    const afterHandler = jest.fn()
    const jobHandler = jest.fn()
    const functionHandler = jest.fn()
    const extensionHandler = jest.fn()

    Nimbu.Cloud.before(EventType.ORDER_CREATED, 'orders', beforeHandler)
    Nimbu.Cloud.after(EventType.ORDER_UPDATED, undefined, afterHandler)
    Nimbu.Cloud.job('syncOrders', jobHandler)
    Nimbu.Cloud.define('calculateTotals', functionHandler)
    Nimbu.Cloud.extend(ViewType.ORDER_SHOW, 'orders', { name: 'Order summary' }, extensionHandler)

    expect(getBeforeCallbackHandler({ event: EventType.ORDER_CREATED, slug: 'orders' })).toBe(beforeHandler)
    expect(getAfterCallbackHandler({ event: EventType.ORDER_UPDATED })).toBe(afterHandler)
    expect(getJobHandler('syncOrders')).toBe(jobHandler)
    expect(getCloudFunctionHandler('calculateTotals')).toBe(functionHandler)
    expect(getExtendHandler({ view: ViewType.ORDER_SHOW, slug: 'orders', name: 'Order summary' })).toBe(
      extensionHandler,
    )
  })

  test('throws useful errors for invalid event and view specs', () => {
    expect(() => getBeforeCallbackHandler({ event: 'unknown.event' as EventType })).toThrow(
      'invalid event type "unknown.event"',
    )
    expect(() => getExtendHandler({ view: 'unknown.view' as ViewType, name: 'Widget' })).toThrow(
      'invalid view type "unknown.view"',
    )
  })
})

describe('cloud code request mocks', () => {
  test('creates route request and response defaults', () => {
    const { request, response } = mockRequest(CloudCodeHandleType.Route, { path: '/orders' })

    expect(request).toMatchObject({
      headers: {},
      host: 'nimbu.test',
      locale: 'en',
      params: {},
      path: '/orders',
      simulating: false,
    })
    expect(jest.isMockFunction(response.render)).toBe(true)
    expect(jest.isMockFunction(response.json)).toBe(true)
  })

  test('creates function request metadata when none is supplied', () => {
    const { request, response } = mockRequest(CloudCodeHandleType.Function)

    expect(request.params).toEqual({})
    expect(request.meta.installation_id).toEqual(expect.any(String))
    expect(request.meta.request_id).toEqual(expect.any(String))
    expect(jest.isMockFunction(response.success)).toBe(true)
  })

  test('preserves supplied callback request attributes', () => {
    const object = Nimbu.Object('orders')
    const { request, response } = mockRequest(CloudCodeHandleType.Callback, {
      object,
      changes: { status: ['new', 'paid'] },
    })

    expect(request.object).toBe(object)
    expect(request.changes).toEqual({ status: ['new', 'paid'] })
    expect(jest.isMockFunction(response.error)).toBe(true)
  })
})

describe('cloud code runners', () => {
  beforeEach(async () => {
    await setup()
  })

  test('runs cloud functions and returns the Rails payload shape', async () => {
    Nimbu.Cloud.define('calculateTotals', async (request, response) => {
      await Promise.resolve()
      return response.success({ total: request.params.total })
    })

    await expect(runCloudFunction('calculateTotals', { params: { total: 42 } })).resolves.toEqual({
      result: { total: 42 },
      message: 'Running Cloud Function failed',
      error: false,
      status: undefined,
    })
  })

  test('runs cloud function error responses with Rails status semantics', async () => {
    Nimbu.Cloud.define('blocked', (_request, response) => response.error(403))

    await expect(runCloudFunction('blocked')).resolves.toEqual({
      result: undefined,
      message: 'Running Cloud Function failed',
      error: true,
      status: 403,
    })
  })

  test('runs jobs and collects progress messages', async () => {
    Nimbu.Cloud.job('sync', (request, response) => {
      response.message(`site:${request.params.site}`)
      response.success('done')
    })

    await expect(runJob('sync', { params: { site: 'nimbu' } })).resolves.toEqual({
      error: false,
      message: 'done',
      messages: ['site:nimbu'],
    })
  })

  test('runs callbacks and returns save JSON plus validation errors', async () => {
    const object = Nimbu.Object('orders', { status: 'draft' })
    Nimbu.Cloud.before(EventType.ORDER_UPDATED, 'orders', (request, response) => {
      request.object.set('status', 'blocked')
      return response.error('status', 'cannot change')
    })

    await expect(
      runCallback('before', { event: EventType.ORDER_UPDATED, slug: 'orders' }, { object }),
    ).resolves.toEqual({
      object: { status: 'blocked' },
      message: undefined,
      success: false,
      error: true,
      validation_errors: { status: ['cannot change'] },
    })
  })

  test('runs routes and extensions with rendering payloads', async () => {
    Nimbu.Cloud.get('/orders', (_request, response) => response.json({ ok: true }, { status: 202 }))
    Nimbu.Cloud.extend(ViewType.ORDER_SHOW, 'orders', { name: 'Inspect' }, (_request, response) =>
      response.modal({ title: 'Order', fields: [] }),
    )

    await expect(runRoute('GET', '/orders')).resolves.toEqual({ status: 202, json: { ok: true } })
    await expect(runExtension({ view: ViewType.ORDER_SHOW, slug: 'orders', name: 'Inspect' })).resolves.toEqual({
      result: undefined,
      message: undefined,
      error: false,
      redirect_to: undefined,
      action: 'modal',
      data: { title: 'Order', fields: [] },
    })
  })

  test('runs routes with raw success and stringified error bodies', async () => {
    Nimbu.Cloud.get('/raw', (_request, response) => response.success('ok', { status: 201 }))
    Nimbu.Cloud.get('/invalid', (_request, response) => response.error(422, { code: 'invalid' }))

    await expect(runRoute('GET', '/raw')).resolves.toEqual({ status: 201, headers: {}, body: 'ok' })
    await expect(runRoute('GET', '/invalid')).resolves.toEqual({
      status: 422,
      headers: {},
      body: '{"code":"invalid"}',
    })
  })
})

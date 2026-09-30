import Nimbu, {
  customerFromFixture,
  getModuleMock,
  mockAPI,
  mockModule,
  mockNimbuAPI,
  mockQueryResults,
  objectFromFixture,
  setup,
} from '../src/js-sdk-utils'

describe('Nimbu SDK test helpers', () => {
  beforeEach(() => {
    if (typeof mockAPI.mockReset === 'function') mockAPI.mockReset()
    if (typeof mockAPI.reset === 'function') mockAPI.reset()
  })

  test('setup exposes the mocked Nimbu SDK globally', async () => {
    await setup()

    expect(global.Nimbu).toBe(Nimbu)
    expect(jest.isMockFunction(Nimbu.Cloud.run)).toBe(true)
    expect('Future' in Nimbu).toBe(false)
  })

  test('setup passes endpoint and installation id to the SDK initializer', async () => {
    await setup({
      accessToken: 'access-token',
      endpoint: 'https://api.test.nimbu.io',
      installationId: 'installation-1',
    })

    expect(Nimbu.Config.accessToken).toBe('access-token')
    expect(Nimbu.Config.endpoint).toBe('https://api.test.nimbu.io')
    expect(Nimbu.Config.installationId).toBe('installation-1')

    await setup({ accessToken: 'next-token' })

    expect(Nimbu.Config.accessToken).toBe('next-token')
    expect(Nimbu.Config.endpoint).toBe('https://api.nimbu.io')
    expect(Nimbu.Config.installationId).toEqual(expect.any(String))
  })

  test('mockQueryResults backs first, find, count, get, and collection fetch with an in-memory store', async () => {
    const { orders } = mockQueryResults({
      orders: [
        { id: 'order-1', status: 'draft', total: 10 },
        { id: 'order-2', status: 'paid', total: 20 },
      ],
    })

    const paid = await Nimbu.Query('orders').equalTo('status', 'paid').first()
    const all = await Nimbu.Query('orders').ascending('total').find()
    const fetched = await Nimbu.Query('orders').get('order-1')
    const collection = await Nimbu.Query('orders').collection().fetch()

    expect(paid?.id).toBe('order-2')
    expect(all.map((order: any) => order.id)).toEqual(['order-1', 'order-2'])
    expect(await Nimbu.Query('orders').count()).toBe(2)
    expect(fetched?.get('status')).toBe('draft')
    expect(collection.models.map((order: any) => order.id)).toEqual(['order-1', 'order-2'])
    expect(orders[0].equalTo).toHaveBeenCalledWith('status', 'paid')
  })

  test('mockQueryResults replaces previous fixture state and collection fetch updates models', async () => {
    mockQueryResults({
      orders: [{ id: 'order-1', status: 'paid' }],
    })
    expect(await Nimbu.Query('orders').count()).toBe(1)

    mockQueryResults({
      orders: [],
    })
    const collection = Nimbu.Query('orders').collection()
    const fetched = await collection.fetch()

    expect(await Nimbu.Query('orders').count()).toBe(0)
    expect(collection.models).toEqual([])
    expect(fetched).toBe(collection)
  })

  test('mockQueryResults preserves supplied Nimbu object instances', async () => {
    const order = Nimbu.Object('orders', { status: 'draft' })
    order.id = 'order-1'

    mockQueryResults({
      orders: [order],
    })

    const queried = await Nimbu.Query('orders').first()
    queried.set('status', 'paid')
    await queried.save()

    expect(queried).toBe(order)
    expect(order.get('status')).toBe('paid')
    expect(order.save).toHaveBeenCalled()
  })

  test('mockQueryResults supports null first-result fixtures', async () => {
    const {
      destinations: [destinationQuery],
    } = mockQueryResults({
      destinations: [null],
    })

    const result = await Nimbu.Query('destinations').equalTo('code', 'missing').first()

    expect(result).toBeNull()
    expect(destinationQuery.equalTo).toHaveBeenCalledWith('code', 'missing')
  })

  test('Nimbu.Query works as a constructor and accepts registered classes', async () => {
    mockQueryResults({ orders: [{ id: 'order-1' }] })

    const query = new Nimbu.Query('orders')
    const Order = Nimbu.Object.extend('orders')

    expect(query).toBeInstanceOf(Nimbu.Query)
    expect((await query.find()).map((order: any) => order.id)).toEqual(['order-1'])
    expect((await new Nimbu.Query(Order).first())?.id).toBe('order-1')
  })

  test('first() leaves the query limit alone, like SDK v2', async () => {
    mockQueryResults({
      orders: [
        { id: 'order-1', total: 10 },
        { id: 'order-2', total: 20 },
      ],
    })
    const query = Nimbu.Query('orders').ascending('total')

    expect((await query.first())?.id).toBe('order-1')
    expect((await query.find()).map((order: any) => order.id)).toEqual(['order-1', 'order-2'])
    expect(await Nimbu.Query('orders').equalTo('total', 99).first()).toBeUndefined()
  })

  test('ascending/descending replace the sort and addAscending adds a secondary key', async () => {
    mockQueryResults({
      orders: [
        { id: 'a', status: 'paid', total: 20 },
        { id: 'b', status: 'draft', total: 10 },
        { id: 'c', status: 'paid', total: 10 },
      ],
    })
    const ids = async (query: any) => (await query.find()).map((order: any) => order.id)

    expect(await ids(Nimbu.Query('orders').descending('total').ascending('id'))).toEqual(['a', 'b', 'c'])
    expect(await ids(Nimbu.Query('orders').ascending('status').addDescending('total'))).toEqual(['b', 'a', 'c'])
    expect(await ids(Nimbu.Query('orders').ascending('status, id'))).toEqual(['b', 'a', 'c'])
  })

  test('clone copies constraints without sharing later changes', async () => {
    mockQueryResults({
      orders: [
        { id: 'order-1', status: 'paid' },
        { id: 'order-2', status: 'paid' },
        { id: 'order-3', status: 'draft' },
      ],
    })
    const paid = Nimbu.Query('orders').equalTo('status', 'paid')
    const copy = paid.clone()
    copy.limit(1)

    expect(await paid.count()).toBe(2)
    expect(await copy.find()).toHaveLength(1)
  })

  test('contains, search, includeAll and each follow the SDK query API', async () => {
    mockQueryResults({
      orders: [
        { id: 'order-1', tags: ['vip'], note: 'Rush delivery' },
        { id: 'order-2', tags: [], note: 'regular' },
      ],
    })
    const seen: string[] = []

    expect((await Nimbu.Query('orders').contains('tags', 'vip').find()).map((o: any) => o.id)).toEqual(['order-1'])
    expect((await Nimbu.Query('orders').contains('note', 'Rush').find()).map((o: any) => o.id)).toEqual(['order-1'])
    expect((await Nimbu.Query('orders').search('rush').includeAll().find()).map((o: any) => o.id)).toEqual(['order-1'])
    await Nimbu.Query('orders').each((order: any) => seen.push(order.id))
    expect(seen).toEqual(['order-1', 'order-2'])
    await expect(
      Nimbu.Query('orders')
        .limit(1)
        .each(() => {}),
    ).rejects.toBe('Cannot iterate on a query with sort, skip, or limit.')
  })

  test('realtime entry points throw REALTIME_CLOSED, as in Nimbu Cloud Code', async () => {
    await setup({ fixtures: { orders: [{ id: 'order-1' }] } })
    const order = await Nimbu.Query('orders').get('order-1')
    const closed = expect.objectContaining({ code: Nimbu.Error.REALTIME_CLOSED })

    expect(() => Nimbu.Query('orders').subscribe({})).toThrow(closed)
    expect(() => Nimbu.Query('orders').live()).toThrow(closed)
    expect(() => Nimbu.Object.watch({})).toThrow(closed)
    expect(() => order.watch({})).toThrow(closed)
  })

  test('objects from the factory are Nimbu.Object instances and keep short_id across saves', async () => {
    await setup({ fixtures: { orders: [{ id: 'order-1', short_id: 'ABC123', status: 'draft' }] } })

    const order = await Nimbu.Query('orders').get('order-1')
    order.set('status', 'paid')
    await order.save()
    const reloaded = await Nimbu.Query('orders').get('order-1')

    expect(Nimbu.Object('orders')).toBeInstanceOf(Nimbu.Object)
    expect(order.get('short_id')).toBeUndefined()
    expect(reloaded.shortId).toBe('ABC123')
    expect(reloaded.get('status')).toBe('paid')
  })

  test('fixture helpers hydrate objects and customers', () => {
    const order = objectFromFixture('orders', '{"id":"order-1","status":"paid"}')
    const customer = customerFromFixture({ id: 'customer-1', email: 'peter@example.com' })

    expect(order.id).toBe('order-1')
    expect(order.get('status')).toBe('paid')
    expect(customer.id).toBe('customer-1')
    expect(customer.get('email')).toBe('peter@example.com')
  })

  test('objectFromFixture requires a type', () => {
    expect(() => objectFromFixture(null as unknown as string, {})).toThrow('type is required')
  })

  test('saved and destroyed objects update the in-memory store', async () => {
    await setup()

    const order = Nimbu.Object('orders', { status: 'draft' })
    await order.save()
    order.set('status', 'paid')
    await order.save()

    expect(order.id).toEqual(expect.any(String))
    expect((await Nimbu.Query('orders').get(order.id)).get('status')).toBe('paid')

    await order.destroy({ wait: true })

    await expect(Nimbu.Query('orders').get(order.id)).rejects.toMatchObject({ code: 101 })
  })

  test('mockNimbuAPI serves SDK channel routes from the in-memory store', async () => {
    await setup({
      fixtures: {
        orders: [{ id: 'order-1', status: 'paid' }],
      },
    })
    mockNimbuAPI()

    const response = await Nimbu.API.get('/channels/orders/entries')

    expect(response.map((entry: any) => entry.id)).toEqual(['order-1'])
  })

  test('SDK API calls use raw mockAPI unless mockNimbuAPI is enabled', async () => {
    await setup({
      fixtures: {
        orders: [{ id: 'order-1', status: 'paid' }],
      },
    })

    await expect(Nimbu.API.get('/channels/orders/entries')).rejects.toBeDefined()

    mockNimbuAPI()

    await expect(Nimbu.API.get('/channels/orders/entries')).resolves.toEqual([
      expect.objectContaining({ id: 'order-1' }),
    ])
  })

  test('module mocks are registered and reset through setup', async () => {
    await setup()
    mockModule('soap', {
      client: jest.fn(() => ({ call: jest.fn(async () => ({ ok: true })) })),
    })

    expect(getModuleMock('soap').client()).toEqual({ call: expect.any(Function) })

    await setup()

    expect(() => getModuleMock('soap')).toThrow("No mock registered for Cloud Code module 'soap'")
  })
})

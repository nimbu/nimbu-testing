import { mapValues } from 'lodash'
import NimbuSDK from 'nimbu-js-sdk'

import Debug from 'debug'

const debug = Debug('nimbu:console.log')
const Nimbu = {
  Cloud: {
    // cloud code dsl
    extend: jest.fn(),
    job: jest.fn(),
    schedule: jest.fn(),
    unschedule: jest.fn(),
    define: jest.fn(),
    route: jest.fn(),
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
    before: jest.fn(),
    after: jest.fn(),

    // nimbu-js-sdk method to invoke a cloud function
    run: jest.fn(),
  },
  Object: (...args: any[]) => {
    const result = new NimbuSDK.Object(...args)
    result.save = jest.fn()
    return result
  },
  Error: NimbuSDK.Error,
  Atomic: NimbuSDK.Atomic,
  API: NimbuSDK.API,
  Events: NimbuSDK.Events,
  Future: NimbuSDK.Future,
  Relation: NimbuSDK.Relation,
  Gallery: NimbuSDK.Gallery,
  GalleryImage: NimbuSDK.GalleryImage,
  Query: NimbuSDK.Query,
  Customer: NimbuSDK.Customer,
  ACL: NimbuSDK.ACL,
  Role: NimbuSDK.Role,
  File: NimbuSDK.File,
  Collection: NimbuSDK.Collection,
  Coupon: NimbuSDK.Coupon,
  Device: NimbuSDK.Device,
  Order: NimbuSDK.Order,
  ProductAggregate: NimbuSDK.ProductAggregate,
  Product: NimbuSDK.Product,
  SelectOption: NimbuSDK.SelectOption,
  SelectOptionList: NimbuSDK.SelectOptionList,
}

jest.spyOn(Nimbu, 'Object')

// beforeEach(() => Nimbu.Object.mockClear())
export function setup() {
  global.Nimbu = Nimbu

  // silence console.log in tests, but allow to be visible using DEBUG=nimbu
  console.log = debug
}

const createMockQuery = (result) => ({
  equalTo: jest.fn().mockReturnThis(),
  first: () => NimbuSDK.Future.as(result),
})

export function mockQueryResults(resultsPerSlug) {
  const queriesPerSlug = mapValues(resultsPerSlug, (results) => results.map(createMockQuery))

  const mockPerSlug = mapValues(queriesPerSlug, (queries) =>
    queries.reduce(
      (mock, query) => mock.mockImplementation(() => query),
      jest.fn(() => createMockQuery(null)),
    ),
  )

  Nimbu.Query = function (slug) {
    if (!mockPerSlug[slug]) return createMockQuery(null)
    return mockPerSlug[slug]()
  }

  return queriesPerSlug
}

export default Nimbu

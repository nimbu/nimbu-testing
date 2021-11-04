import { mapValues } from 'lodash'
import NimbuSDK from 'nimbu-js-sdk'

import Debug from 'debug'

const debug = Debug('nimbu:console.log')
const Nimbu = {
  Cloud: {
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
  },
  Future: NimbuSDK.Future,
  Query: NimbuSDK.Query,
  Object: (...args: any[]) => {
    const result = new NimbuSDK.Object(...args)
    result.save = jest.fn()
    return result
  },
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

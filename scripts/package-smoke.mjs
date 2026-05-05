import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = process.cwd()

function pnpm(args, options = {}) {
  return execFileSync('corepack', ['pnpm@10.33.2', ...args], options)
}

const packed = pnpm(['pack', '--pack-destination', tmpdir()], {
  cwd: root,
  encoding: 'utf8',
})
  .trim()
  .split('\n')
  .at(-1)

const packagePath = packed.startsWith('/') ? packed : join(tmpdir(), packed)
const smokeDir = mkdtempSync(join(tmpdir(), 'nimbu-testing-smoke-'))

writeFileSync(
  join(smokeDir, 'package.json'),
  JSON.stringify(
    {
      private: true,
      type: 'commonjs',
      scripts: {
        test: 'jest --runInBand',
      },
      packageManager: 'pnpm@10.33.2',
      dependencies: {
        '@nimbu/testing': packagePath,
        '@jest/globals': '^30.3.0',
        jest: '^30.3.0',
      },
      devDependencies: {},
    },
    null,
    2,
  ),
)

writeFileSync(
  join(smokeDir, 'package.test.cjs'),
  `
const { CloudCodeHandleType, Nimbu, mockAPI, mockRequest, setup } = require('@nimbu/testing')

test('package can be consumed from CommonJS in Jest', async () => {
  await setup()
  const { request, response } = mockRequest(CloudCodeHandleType.Route, { path: '/smoke' })

  expect(global.Nimbu).toBe(Nimbu)
  expect(request.path).toBe('/smoke')
  expect(jest.isMockFunction(response.success)).toBe(true)
  expect(typeof mockAPI).toBe('function')
})
`,
)

pnpm(['install', '--ignore-scripts'], { cwd: smokeDir, stdio: 'inherit' })
pnpm(['test'], { cwd: smokeDir, stdio: 'inherit' })

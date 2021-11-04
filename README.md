# nimbu-client

[![Build Status](https://travis-ci.org/nimbu/node-nimbu-client.png?branch=master)](https://travis-ci.org/nimbu/node-nimbu-client)
[![codecov](https://codecov.io/gh/nimbu/node-nimbu-client/branch/master/graph/badge.svg)](https://codecov.io/gh/nimbu/node-nimbu-client)

A thin wrapper around the [Nimbu](https://www.nimbu.io) API.

- [nimbu-client](#nimbu-client)
  - [Install](#install)
  - [Usage](#usage)
    - [HTTP Proxies](#http-proxies)
    - [Running tests](#running-tests)

## Install

```sh
$ npm install nimbu-client --save
```

## Usage

To begin, require the Nimbu module and create the client, passing in an API
token:

```javascript
const Nimbu = require('nimbu-client');
const nimbu = new Nimbu({ token: apiToken });
```

If a customer session token is needed, you can pass this too:

```javascript
const nimbu = new Nimbu({ token: apiToken, sessionToken: sessionToken });
```

nimbu-client has `get`, `post`, `patch`, and `delete` functions which can make
requests with the specified HTTP method to any endpoint:

```javascript
// GET requests
nimbu.get('/channels').then(channels => {
  // do something with channel info
});

// POST requests with body
nimbu.post('/channels', { body: { name: 'foo' } }).then(channel => {});

// PATCH requests with body
nimbu.patch('/channels/foo', { body: { name: 'bar' } }).then(channel => {});

// DELETE requests
nimbu.delete('/channels/bar').then(channel => {});
```

There is also an even more generic `request` function that can accept many more
options:

```javascript
nimbu
  .request({
    method: 'GET',
    path: '/channels',
    parseJSON: false,
  })
  .then(response => {});
```

### HTTP Proxies

If you'd like to make requests through an HTTP proxy, set the
`NIMBU_HTTP_PROXY_HOST` environment variable with your proxy host, and
`NIMBU_HTTP_PROXY_PORT` with the desired port (defaults to 8080). nimbu-client
will then make requests through this proxy instead of directly to
api.nimbu.io.

### Running tests

nimbu-client uses [ava](https://github.com/avajs/ava) for tests:

```bash
$ npm test
```

# JsisApi

Simple and lightweight Node.js API structure for **HTTP + WebSocket** APIs.

- No dependencies
- GET / POST / HEAD
- WebSocket
- Request validation
- File upload / download
- API versioning
- Request filters

## Install

```bash
npm install jsisapi
```

## Quick Start

JsisApi uses `_q` to select the API.

### 1. GET

**Server**

```js
const http = require("http");
const { api } = require("jsisapi");

const config = {
    name: "/api_1",
    temp: "./temp",
    limit: 60
};

const routes = {
    GET: {
        hello: {
            name: ["string", 1, 100],

            _: async (data, res, req, raw) => {
                return {
                    ok: true,
                    message: "Hello " + data.name
                };
            }
        }
    }
};

const app = api(config, routes);

http.createServer(app.request_http).listen(3000);
```

**Client**

```js
const res = await fetch(
    "http://localhost:3000/api_1?_q=user&id=10"
);

console.log(await res.json());
```

Response:

```json
{
    "ok": true,
    "id": 10
}
```

---

### 2. POST

**Server**

```js
const http = require("http");
const { api } = require("jsisapi");

const config = {
    name: "/api_1",
    temp: "./temp",
    limit: 60
};

const routes = {
    GET: { \\... },
    POST: {
        login: {
            username: ["string", 1, 64],
            password: ["string", 1, 128],

            _: async data => ({
                ok: true,
                username: data.username
            })
        }
    }
};

const app = api(config, routes);

http.createServer(app.request_http).listen(3000);

```

**Client**

```js
const res = await fetch("http://localhost:3000/api_1", {
    method: "POST",
    headers: {
        "Content-Type": "application/json"
    },
    body: JSON.stringify({
        _q: "login",
        username: "john",
        password: "secret"
    })
});

console.log(await res.json());
```

---

### 3. WebSocket

**Server**

```js
const http = require("http");
const { api } = require("jsisapi");

const config = {
    name: "/api_1",
    temp: "./temp",
    limit: 60
};

const routes = {
    GET: { \\... },
    POST: { \\...},
    WS: {
        ping: {
            _: async (data, socket) => {
                return {
                    ok: true,
                    message: "pong"
                }
            }
        }
    }
};

const app = api(config, routes);

http.createServer(app.request_http).listen(3000);
new WebSocketServer({ server: http }).on("connection", app.request_ws) 

```

Attach it to your WebSocket server:

```js
ws.on("connection", socket => {
    app.request_ws(socket, req);
});
```

**Client**

```js
const ws = new WebSocket("ws://localhost:3000/api_1");

ws.onopen = () => {
    ws.send(JSON.stringify({
        _q: "ping",
        _rq: 1
    }));
};

ws.onmessage = event => {
    console.log(JSON.parse(event.data));
};
```

Response:

```json
{
    "ok": true,
    "message": "pong",
    "_rq": 1
}
```

`_rq` is the request ID supplied by the client and returned by JsisApi.

## API Structure

```js
{
    GET: {},
    POST: {},
    HEAD: {},
    WS: {},
    FILTERS: {}
}
```

Each endpoint contains validation rules and `_` as its handler:

```js
{
    user: {
        id: ["int", 1, 1000000],

        _: async data => {
            return { ok: true };
        }
    }
}
```

The handler receives only fields defined by the endpoint.

## Validation

Rule format:

```js
field: [type, min, max, required, filter]
```

Example:

```js
{
    id: ["int", 1, 1000000],
    name: ["string", 1, 100],
    price: ["float", 0, 1000000],
    enabled: ["bool"],
    items: ["array", 1, 100]
}
```

Supported types:

```text
int
float
string
bool
array
file
image
audio
video
```

Fields are required by default.

```js
name: ["string", 1, 100, false]
```

The fifth value can transform or validate a value:

```js
name: [
    "string",
    1,
    100,
    true,
    value => value.trim()
]
```

## Modules

Split APIs into separate modules:

```js
const app = api(config, [
    usersApi,
    productsApi,
    ordersApi
]);
```

Each module can contain:

```js
{
    GET: {},
    POST: {},
    HEAD: {},
    WS: {},
    FILTERS: {}
}
```

## Filters

Global filters are defined in `FILTERS`:

```js
{
    FILTERS: {
        request: async (res, req, data) => {
            // authentication
            return true;
        },

        websocket_open: async (socket, req) => {
            return true;
        },

        websocket_message: async (data, socket, req) => {
            return false;
        },

        websocket_close: socket => {},

        upload_token: async (api, upload, socket, req) => {
            return true;
        },

        upload: async (field, data, res, req) => {
            return true;
        },

        upload_chunk: async (field, data, written, chunk) => {
            return true;
        }
    }
}
```

Returning `false` from `request`, `websocket_open`, or `upload_token` rejects the operation.

## File Upload

Declare a file using its expected size:

```js
POST: {
    upload: {
        image: ["image", 1, 10_000_000],

        _: async data => ({
            ok: true
        }),

        __: async data => {
            // called after upload finishes
            console.log(data.image)
            
            return { ok: true };
        }
    }
}
```

The initial API request returns an upload token.

Upload the file with:

```http
POST /api_1
Token: <token>
Field: image
```

The file is streamed to the temporary directory.

Supported file types:

```text
file
image (JPEG)
audio (MP3)
video (MP4)
```

## File Download

An endpoint can return a file descriptor:

```js
GET: {
    download: {
        _: async () => ({
            stat,
            createReadStream,
            close
        })
    }
}
```

JsisApi streams the file and supports HTTP byte ranges.

## Configuration

```js
const config = {
    name: "/api_1",
    temp: "./temp",
    limit: 60
};
```

| Option | Description |
|---|---|
| `name` | API name and version |
| `temp` | Temporary upload directory |
| `limit` | WebSocket requests per minute |

For example:

```text
/api_1
```

means API name `api_` and version `1`.

Older API versions are rejected with:

```json
{
    "ok": false,
    "error": "INVALID_VERSION"
}
```


## Error responses

Common built-in errors include:

| Error | Meaning |
|---|---|
| `INVALID_VERSION` | Requested API version is older than the server version |
| `INVALID_JSON` | Request body or WebSocket message is not valid JSON |
| `INVALID_METHOD` | Unsupported HTTP method |
| `INVALID_API_QUERY` | `_q` does not identify an API endpoint |
| `INVALID_FIELD` | A request field failed validation |
| `MAX_REQUEST` | WebSocket connection exceeded its request limit |
| `FILTER_ERROR` | A filter rejected the request |
| `ERROR` | API handler threw an error or returned `false` |

## Exports

```js
const {
    api,
    utils,
    valid
} = require("jsisapi");
```

### `api(config, modules)`

Creates the API handlers:

```js
{
    request_http,
    request_ws
}
```

### `valid(data, schema)`

Validate an object manually:

```js
const { valid } = require("jsisapi");

const schema = {
    id: ["int", 1, 1000],
    name: ["string", 1, 100]
};

const ok = valid(
    {
        id: 10,
        name: "John"
    },
    schema
);
```

### `utils`

Utility validation and conversion functions used by custom filters.


# licence
 <p>
    <img width="32px" src="https://raw.githubusercontent.com/seezaara/RocketV2ray/main/doc/logo.png"><a href="https://www.youtube.com/@seezaara">seezaara youtube</a>
<br>
    <img width="32px" src="https://raw.githubusercontent.com/seezaara/RocketV2ray/main/doc/logo.png"><a href="https://t.me/seezaara">seezaara telegram</a>
</p> 

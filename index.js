"use strict";

const fs = require("fs")
const url = require('url');
const type = require("./type")
const utils = require("./utils")
const server = require("./server")
const session = require("./session")
//-------------- filters: 
// websocket_open
// websocket_message
// websocket_close
// upload_token
// request
// upload 
// ------------ config :
// version
// name
// temp
// limit
// ------------------------------------
function api(config, list) {
    const API_NAME = config.name.substring(0, config.name.lastIndexOf("_") + 1)
    const VERSION = +config.name.substring(API_NAME.length)

    const api_length = API_NAME.length + 1 // the first "/"
    const version_length = config.name.length - API_NAME.length
    const full_length = api_length + version_length

    const UPLOAD_TEMP = config.temp
    const MAX_REQUEST_LIMIT = config.limit || 60

    fs.mkdirSync(UPLOAD_TEMP, { recursive: true });
    // ------------------------------------
    // read modules
    // ------------------------------------

    list = read_modules(list)

    const FILTERS = { ...list.FILTERS, ...config.filters }
    const HEAD_list = list.HEAD
    const POST_list = list.POST
    const GET_list = list.GET
    const WS_list = list.WS

    // ------------------------------------
    // Ws request
    // ------------------------------------

    function ws_open(ws, req) {
        if (!('user-agent' in req.headers))
            return ws.close();
        var req_api = req.url.substring(1, api_length)

        if (req_api != API_NAME) {
            return false
        }

        if (+req.url.substring(api_length, full_length) < VERSION) {
            ws.send('{"ok":false,"error":"INVALID_VERSION"}')
            ws.close();
            return false
        }
        return true
    }

    async function request_ws(socket, req) {
        if (!ws_open(socket, req) ||
            !(FILTERS.websocket_open ? await FILTERS.websocket_open(socket, req) : true))
            return false
        socket.on("message", async function (data) {
            if (!max_request(socket, MAX_REQUEST_LIMIT))
                return socket.send(`{"ok":false,"error":"MAX_REQUEST"}`);

            try {
                data = JSON.parse(data);
            } catch {
                return socket.send(`{"ok":false,"error":"INVALID_JSON"}`);
            }

            if (FILTERS.websocket_message && await FILTERS.websocket_message(data, socket, req))
                return socket.send(`{"ok":false,"error":"FILTER_ERROR"}`);

            const api = WS_list[data._q];

            if (!api || typeof data._rq != "number") {
                return socket.send(JSON.stringify({ ok: false, error: "INVALID_API_QUERY", _rq: +data._rq || 0 }));
            }

            const safe_data = {};
            for (let field in api) {

                if (field === "_" || field === "__") continue;

                if (!type.check(data, field, api[field])) {
                    return socket.send(JSON.stringify({ ok: false, error: "INVALID_FIELD", field, _rq: +data._rq }));
                }

                if (field in data)
                    safe_data[field] = data[field];
            }
            // Run API handler
            try {
                const out = await api._(safe_data, socket, req, data)

                if (out === undefined)
                    return
                if (out === false)
                    return res.end(`{"ok":false,"error":"ERROR"}`);

                if (!!api.__ && out.ok)
                    out._token = await upload_start(api, safe_data, socket, req, FILTERS.upload_token)

                out._rq = +data._rq
                return socket.send(JSON.stringify(out));
            } catch (err) {
                console.error("API error:", err);
                return socket.send(`{"ok":false,"error":"ERROR"}`);
            }
        });
        if (FILTERS.websocket_close)
            socket.once("close", FILTERS.websocket_close);
    }
    // ------------------------------------
    // Http Request
    // ------------------------------------ 
    async function request_http(req, res, next) {
        if (req.url.substring(1, api_length) !== API_NAME)
            return next ? next() : true


        if (+req.url.substring(api_length, full_length) < VERSION) {
            return res.end('{"ok":false,"error":"INVALID_VERSION"}')
        }

        if (req.method === "POST" && req.headers["token"])
            return server.upload(req, res, UPLOAD_TEMP, FILTERS.upload, FILTERS.upload_chunk)

        var list = {}

        if (req.method === "GET") {
            var data = req.query || url.parse(req.url, true).query || {};
            list = GET_list
        } else if (req.method === "POST") {
            let b = "";
            req.on("data", x => b += x);

            await new Promise(r => req.on("end", r));

            try {
                var data = JSON.parse(b);
            } catch (e) {
                return res.end(`{"ok":false,"error":"INVALID_JSON"}`);
            }
            list = POST_list
        }
        else if (req.method === "HEAD") {
            list = HEAD_list;
        } else
            return res.end('{"ok":false,"error":"INVALID_METHOD"}')


        if (FILTERS.request && !FILTERS.request(res, req, data))
            return res.end('{"ok":false,"error":"FILTER_ERROR"}')

        const api = list[data._q];
        if (!api)
            return res.end(`{"ok":false,"error":"INVALID_API_QUERY"}`);

        const safe_data = {};
        for (let field in api) {

            if (field === "_" || field === "__") continue;

            if (!type.check(data, field, api[field]))
                return res.end(JSON.stringify({ ok: false, error: "INVALID_FIELD", field }));

            if (field in data)
                safe_data[field] = data[field];
        }

        try {
            const out = await api._(safe_data, res, req, data)

            if (out == undefined)
                return
            if (out == false)
                return res.end(`{"ok":false,"error":"ERROR"}`);
            if (typeof out.close === 'function') {
                return server.download(req, res, out)
            }

            return res.end(JSON.stringify(out));
        } catch (err) {
            console.error("API error:", err);
            return res.end(`{"ok":false,"error":"ERROR"}`);
        }
    }
    // -------------------
    return {
        request_ws,
        request_http
    }
}


function max_request(obj, MAX_REQUEST_LIMIT) {
    const cycle = (Date.now() / 60000) | 0; // integer cycle id (60s buckets)
    if (obj.$_t !== cycle) {                // t = last cycle id
        obj.$_t = cycle;
        obj.$_n = 1;                        // n = count in current cycle 
        return true;
    }
    // fast int ops
    const c = obj.$_n | 0;

    if (c < MAX_REQUEST_LIMIT) {
        obj.$_n = c + 1;
        return true;
    }
    return false;
}

function read_modules(modules) {
    if (Array.isArray(modules)) {
        const list = {
            WS: {},
            POST: {},
            HEAD: {},
            GET: {},
            FILTERS: {}
        }
        for (const m of modules) {
            if (m.WS)
                list.WS = { ...list.WS, ...m.WS }
            if (m.POST)
                list.POST = { ...list.POST, ...m.POST }
            if (m.HEAD)
                list.HEAD = { ...list.HEAD, ...m.HEAD }
            if (m.GET)
                list.GET = { ...list.GET, ...m.GET }
            if (m.FILTERS)
                list.FILTERS = { ...list.FILTERS, ...m.FILTERS }
        }
        return list
    } else
        return {
            WS: modules.WS || {},
            POST: modules.POST || {},
            HEAD: modules.HEAD || {},
            GET: modules.GET || {},
            FILTERS: modules.FILTERS || {}
        }
}

const types = Object.keys(type.signs)
async function upload_start(api, safe_data, ws, req, filter) {
    const files = {}
    for (let field in api) {
        if (types.includes(api[field][0]) && safe_data[field]) {
            files[field] = safe_data[field]
        }
    }
    if (Object.keys(files).length == 0)
        return

    const upload = {
        time: Date.now(),
        data: safe_data,
        __: api.__,
        files,
    }

    if (!(await filter(api, upload, ws, req)))
        return

    return session.create_session(upload)
}

module.exports = {
    api,
    utils,
    valid: type.valid
}
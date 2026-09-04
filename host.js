"use strict";

const fs = require("fs");
const path = require("path");
const server = require("./server");

const servers = new WeakMap();

// Route types
const EXACT = 0;
const PREFIX = 1;
const REGEX = 2;
const PARAM = 3;

const MIME = {
    html: "text/html; charset=utf-8",
    htm: "text/html; charset=utf-8",
    css: "text/css; charset=utf-8",
    js: "text/javascript; charset=utf-8",
    mjs: "text/javascript; charset=utf-8",
    json: "application/json; charset=utf-8",
    xml: "application/xml",
    txt: "text/plain; charset=utf-8",
    csv: "text/csv; charset=utf-8",

    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    avif: "image/avif",
    svg: "image/svg+xml",
    ico: "image/x-icon",
    bmp: "image/bmp",

    mp3: "audio/mpeg",
    wav: "audio/wav",
    ogg: "audio/ogg",
    m4a: "audio/mp4",

    mp4: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime",
    avi: "video/x-msvideo",

    pdf: "application/pdf",
    zip: "application/zip",
    gz: "application/gzip",
    wasm: "application/wasm",

    woff: "font/woff",
    woff2: "font/woff2",
    ttf: "font/ttf",
    otf: "font/otf"
};

// --------------------------------------------------
// PARAM register
// --------------------------------------------------

function registerParam(input) {

    const first = input.indexOf(":");
    const pattern = input.slice(0, first);
    const params = [];

    let regex = "^";
    let i = 0;
    let staticStart = 0;

    while (i < input.length) {

        if (input[i] !== ":") {
            i++;
            continue;
        }

        if (i > staticStart)
            regex += input.slice(staticStart, i).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

        i++;

        const nameStart = i;

        while (
            i < input.length &&
            (
                input.charCodeAt(i) >= 65 && input.charCodeAt(i) <= 90 ||
                input.charCodeAt(i) >= 97 && input.charCodeAt(i) <= 122 ||
                input.charCodeAt(i) === 95
            )
        )
            i++;

        if (i === nameStart)
            throw new TypeError("Invalid parameter in route: " + input);

        params.push(input.slice(nameStart, i));

        regex += "(.+?)";
        staticStart = i;
    }

    if (staticStart < input.length)
        regex += input.slice(staticStart).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    return {
        pattern,
        prefixLength: pattern.length,
        regex: new RegExp(regex + "$"),
        params
    };
}

// --------------------------------------------------
// Add route
// --------------------------------------------------

function addRoute(method, pattern, handler, httpServer, staticFolder) {

    if (!httpServer || typeof httpServer.on !== "function")
        throw new TypeError("Invalid HTTP server");

    let routes = servers.get(httpServer);

    if (!routes) {
        routes = [];
        servers.set(httpServer, routes);

        httpServer.on("request", async (request, response) => {

            let pathname = request.url || "/";
            const queryIndex = pathname.indexOf("?");

            if (queryIndex !== -1)
                pathname = pathname.slice(0, queryIndex);

            try {
                pathname = decodeURIComponent(pathname);
            } catch {
                response.statusCode = 400;
                return response.end();
            }

            let nextRoute = false;
            const next = () => nextRoute = true;

            for (let i = 0; i < routes.length; i++) {

                const route = routes[i];

                // Method
                if (route.method && route.method !== request.method)
                    continue;

                // Pattern
                switch (route.type) {

                    case EXACT:
                        if (
                            pathname !== route.pattern &&
                            pathname !== route.patternSlash
                        )
                            continue;
                        break;

                    case PREFIX:
                        if (!pathname.startsWith(route.pattern))
                            continue;
                        break;

                    case PARAM:

                        if (!pathname.startsWith(route.pattern))
                            continue;

                        const param = route.regex.exec(pathname);

                        if (!param)
                            continue;

                        const params = {};

                        for (let i = 0; i < route.params.length; i++)
                            params[route.params[i]] = param[i + 1];

                        request.params = params;

                        break;

                    case REGEX:
                        route.regex.lastIndex = 0;

                        const match = route.regex.exec(pathname);

                        if (!match)
                            continue;

                        request.match = match;
                        break;
                }

                var fd;

                try {

                    // Static folder
                    if (route.folder) {

                        const filePath = path.resolve(
                            route.folder,
                            pathname.slice(route.prefixLength)
                        );

                        const relative = path.relative(route.folder, filePath);

                        if (
                            relative.startsWith("..") ||
                            path.isAbsolute(relative)
                        ) {
                            response.statusCode = 404;
                            return response.end();
                        }

                        const i = pathname.lastIndexOf(".");

                        fd = await fs.promises.open(filePath);

                        return server.download(
                            request,
                            response,
                            fd,
                            {
                                "Content-Type": i === -1 ? "application/octet-stream" : (MIME[pathname.slice(i + 1).toLowerCase()] || "application/octet-stream"),
                                "Cache-Control": "public, max-age=31536000, immutable"
                            }
                        );
                    }

                    // Handler
                    nextRoute = false;

                    const result = route.handler(
                        request,
                        response,
                        next
                    );

                    if (result && typeof result.then === "function")
                        await result;

                    if (nextRoute)
                        continue;

                } catch (error) {

                    if (fd)
                        fd.close().catch(() => { });

                    if (error.code === "ENOENT")
                        continue;

                    console.error("Host error:", error);

                    if (!response.headersSent)
                        response.statusCode = 500;

                    if (!response.writableEnded)
                        response.end();
                }

                return;
            }

            response.statusCode = 404;
            response.end();
        });
    }

    // Static folder
    if (staticFolder) {

        if (!pattern.endsWith("/"))
            pattern += "/";

        routes.push({
            method: 0,
            type: PREFIX,
            pattern,
            handler: null,
            folder: path.resolve(staticFolder),
            prefixLength: pattern.length
        });

        return httpServer;
    }

    // Normal route

    if (typeof pattern === "string") {

        if (pattern.endsWith("*")) {

            routes.push({
                method,
                type: PREFIX,
                pattern: pattern.slice(0, -1),
                handler,
                folder: null,
                prefixLength: 0
            });

            return httpServer;
        }

        if (pattern.includes(":")) {

            const param = registerParam(pattern);

            routes.push({
                method,
                type: PARAM,
                regex: param.regex,
                pattern: param.pattern,
                params: param.params,
                handler,
                folder: null,
                prefixLength: param.prefixLength
            });

            return httpServer;
        }

        routes.push({
            method,
            type: method ? EXACT : PREFIX,
            pattern,
            patternSlash: pattern.endsWith("/") ? pattern : pattern + "/",
            handler,
            folder: null,
            prefixLength: 0
        });

        return httpServer;
    }

    routes.push({
        method,
        type: REGEX,
        regex: pattern,
        handler,
        folder: null,
        prefixLength: 0
    });

    return httpServer;
}


// --------------------------------------------------
// Use
// --------------------------------------------------

function use(pattern, handler, httpServer) {

    if (typeof handler === "string")
        return addRoute(0, pattern, null, httpServer, handler);

    return addRoute(0, pattern, handler, httpServer);
}


// --------------------------------------------------
// Direct request
// --------------------------------------------------

function req(handler, httpServer) {
    return addRoute(0, "", handler, httpServer);
}


// --------------------------------------------------
// GET
// --------------------------------------------------

function get(pattern, handler, httpServer) {
    return addRoute("GET", pattern, handler, httpServer);
}


// --------------------------------------------------
// POST
// --------------------------------------------------

function post(pattern, handler, httpServer) {
    return addRoute("POST", pattern, handler, httpServer);
}


module.exports = {
    use,
    req,
    get,
    post
};
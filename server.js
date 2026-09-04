"use strict";

const fs = require("fs");
const { Transform, pipeline } = require("stream");
const session = require("./session");

const UPLOAD_TIMEOUT = 30000;
const BAD_REQUEST = "HTTP/1.1 400 Bad Request\r\n\r\n";

const noop = () => { };


// --------------------------------------------------
// UPLOAD
// --------------------------------------------------

async function upload(req, res, temp, filter, filterChunk) {

    const token = req.headers.token;
    const field = req.headers.field;

    const data = session.get_session(token);

    if (!data || !field || field.length >= 64)
        return req.socket.end(BAD_REQUEST);

    if (filter && !(await filter(field, data, res, req))) {
        session.delete_session(token);
        return req.socket.end(BAD_REQUEST);
    }

    const file = data.files[field];

    if (!file || !file.size || file.status)
        return req.socket.end(BAD_REQUEST);

    file.status = 1;

    const filename =
        temp + "/" +
        data.time + "_" +
        session.create_cookie_id(36) +
        "_" + field;

    file.temp = filename;

    const output = fs.createWriteStream(filename);
    let written = 0;
    let failed = false;

    const fail = () => {

        if (failed)
            return;

        failed = true;

        req.destroy();
        output.destroy();

        fs.unlink(filename, noop);
        req.socket.end(BAD_REQUEST);
    };


    // ------------------------------------------------
    // Fast path
    // ------------------------------------------------

    if (!file.sign && !filterChunk) {

        req.pipe(output);

        req.once("error", fail);
        output.once("error", fail);

        output.once("finish", async () => {

            if (output.bytesWritten !== file.size)
                return fail();

            await upload_finished(
                file,
                data,
                token,
                res,
                req
            );
        });

        req.socket.setTimeout(UPLOAD_TIMEOUT);

        return;
    }


    // ------------------------------------------------
    // Validation path
    // ------------------------------------------------

    const validate = new Transform({

        transform(chunk, encoding, done) {

            if (!written && file.sign) {

                const hex = chunk
                    .subarray(0, file.sign[0].length / 2)
                    .toString("hex");

                let valid = false;

                for (let i = 0; i < file.sign.length; i++) {
                    if (file.sign[i] === hex) {
                        valid = true;
                        break;
                    }
                }

                if (!valid)
                    return done();
            }

            if (
                written + chunk.length > file.size ||
                (filterChunk &&
                    !filterChunk(field, data, written, chunk))
            )
                return done();

            written += chunk.length;
            done(null, chunk);
        }
    });

    req.once("error", fail);
    output.once("error", fail);
    validate.once("error", fail);

    req.socket.setTimeout(UPLOAD_TIMEOUT);

    pipeline(req, validate, output, err => {
        if (err)
            return fail();
    });

    output.once("finish", async () => {

        if (written !== file.size)
            return fail();

        await upload_finished(
            file,
            data,
            token,
            res,
            req
        );
    });
}


// --------------------------------------------------
// UPLOAD FINISH
// --------------------------------------------------

async function upload_finished(file, data, token, res, req) {

    file.status = 2;

    let output = '{"ok":true}';

    if (
        data.files &&
        Object.values(data.files).every(file => file.status === 2)
    ) {

        delete data.files;
        session.delete_session(token);

        try {
            const result = await data.__(data.data, res, req);
            output = JSON.stringify(result || {});
        } catch (err) {
            console.error("Upload callback error:", err);
            return req.socket.end(BAD_REQUEST);
        }
    }

    res.writeHead(200, {
        "Content-Length": Buffer.byteLength(output),
        "Content-Type": "application/json"
    });

    res.end(output);
}


// --------------------------------------------------
// DOWNLOAD
// --------------------------------------------------

async function download(req, res, file, h) {

    try {

        const stat = await file.stat();

        if (!stat.isFile()) {
            await file.close();
            return req.socket.end(BAD_REQUEST);
        }

        const size = stat.size;
        const range = req.headers.range;

        let start = 0;
        let end = size - 1;
        let status = 200;

        if (range && range.startsWith("bytes=")) {

            const value = range.slice(6);
            const dash = value.indexOf("-");

            if (dash === -1) {
                await file.close();
                return req.socket.end(BAD_REQUEST);
            }

            const startText = value.slice(0, dash);
            const endText = value.slice(dash + 1);

            start = startText ? Number(startText) : 0;
            end = endText ? Number(endText) : size - 1;

            if (
                !Number.isInteger(start) ||
                !Number.isInteger(end) ||
                start < 0 ||
                start >= size ||
                end < start
            ) {
                await file.close();
                return req.socket.end(BAD_REQUEST);
            }

            if (end >= size)
                end = size - 1;

            status = 206;
        }

        const length = end - start + 1;

        const headers = {
            "Accept-Ranges": "bytes",
            "Content-Length": length,
            "Content-Type": "application/octet-stream",
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "no-cache"
        };

        if (status === 206)
            headers["Content-Range"] =
                `bytes ${start}-${end}/${size}`;

        res.writeHead(status, h ? { ...headers, ...h } : headers);

        const stream = file.createReadStream({
            start,
            end
        });

        req.socket.setTimeout(UPLOAD_TIMEOUT);

        stream.once("error", () => {
            file.close().catch(noop);

            if (!res.writableEnded)
                res.destroy();
        });

        stream.once("close", () => {
            file.close().catch(noop);
        });

        stream.pipe(res);

    } catch (err) {

        console.error("Download error:", err);

        file.close().catch(noop);

        if (!res.headersSent)
            req.socket.end(BAD_REQUEST);
        else
            res.destroy();
    }
}


module.exports = {
    upload,
    download
};
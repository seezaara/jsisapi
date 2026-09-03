
const fs = require('fs');
const { Transform } = require('stream');
const session = require("./session");

const UPLOAD_TIMEOUT = 30 * 1000;
const bad_request = 'HTTP/1.1 400 Bad Request\r\n\r\n';
function donot() { }

// ------------------------------------
// Upload function
// ------------------------------------


async function upload(req, res, UPLOAD_TEMP, filter, filter_chunk) {

    // ------------------------------ session + field
    const token = req.headers.token
    const data = session.get_session(token);
    const field = req.headers.field && req.headers.field.length < 64
        ? req.headers.field
        : undefined;

    if (!data || !token || !field)
        return req.socket.end(bad_request);

    if (filter ? !(await filter(field, data, res, req)) : false) {
        session.delete_session(token);
        return req.socket.end(bad_request);
    }

    // ------------------------------ file validation
    const file = data.files[field];

    if (!file || !file.size || file.status)
        return req.socket.end(bad_request);

    file.status = 1;   // file started upload

    // ------------------------------ path
    const file_path = UPLOAD_TEMP + "/" + data.time + "_" + session.create_cookie_id(36) + "_" + field;
    file.temp = file_path;

    const wstream = fs.createWriteStream(file_path);
    let totalWritten = 0;
    let aborted = false;

    function bad(e) {

        if (aborted) return;
        aborted = true;
        req.socket.end(bad_request);

        req.unpipe();
        req.destroy();

        wstream.destroy();
        fs.unlink(file_path, donot);

    }

    // ------------------------------ transform
    const transform = new Transform({
        async transform(chunk, enc, cb) {
            if (totalWritten === 0 && file.sign) {
                if (!file.sign.some(sign =>
                    sign === chunk.subarray(0, sign.length / 2).toString("hex")
                ))
                    return cb(null);
            }

            if (totalWritten > file.size || (filter_chunk ? !(await filter_chunk(field, data, totalWritten, chunk)) : false))
                return cb(null);

            totalWritten += chunk.length;

            cb(null, chunk);
        }
    });

    // ------------------------------ pipe
    req.pipe(transform).pipe(wstream);

    // ------------------------------ timeout
    req.socket.setTimeout(UPLOAD_TIMEOUT);

    // ------------------------------ errors
    req.once("error", bad);
    transform.once("error", bad);
    wstream.once("error", bad);
    // ------------------------------ finish
    wstream.once("finish", async () => {

        if (totalWritten !== file.size)
            return bad();

        file.status = 2;

        var out = '{"ok":true}';

        // ------------------------------ move them after finish
        if (data.files && Object.values(data.files).every(f => f.status === 2)) {
            delete data.files
            session.delete_session(token);

            const rawdata = (await data.__(data.data, res, req))
            try {
                out = JSON.stringify(rawdata || {});
            } catch (e) {
                return bad(e);
            }
        }

        res.writeHead(200, {
            "Content-Length": Buffer.byteLength(out),
            "Content-Type": "application/json"
        });

        res.end(out);
    });
}

// ------------------------------------
// download function
// ------------------------------------

async function download(req, res, fd) {
    try {
        // ------------------------------ file validation
        const stat = await fd.stat(); 

        if (!stat.isFile())
            return bad_request_call();

        // ------------------------------ headers
        const size = stat.size;
        const range = req.headers['range'];

        let headers = {
            'Accept-Ranges': 'bytes',
            'Content-Disposition': 'attachment;',
            'Content-Type': 'application/octet-stream',
            'X-Content-Type-Options': 'nosniff',
            'Cache-Control': 'no-cache'
        };

        let streamOptions;
        let statusCode = 200;

        if (range && range.startsWith('bytes=')) {
            const [startStr, endStr] = range.replace('bytes=', '').split('-');
            const starts = parseInt(startStr, 10) || 0;
            const ends = endStr ? Math.min(parseInt(endStr, 10), size - 1) : size - 1;

            if (starts >= size ||
                ends < starts ||
                starts < 0 ||
                ends > size - 1) {

                return bad_request_call();
            }

            headers['Content-Range'] = `bytes ${starts}-${ends}/${size}`;
            headers['Content-Length'] = ends - starts + 1;
            streamOptions = { start: starts, end: ends };
            statusCode = 206;
        } else {
            headers['Content-Length'] = size;
        }

        const readStream = fd.createReadStream(streamOptions);

        // ------------------------------ badrequest
        
        function bad_request_call() {
            req.socket.end(bad_request);
            fd.close().catch(donot);
            if (readStream)
                readStream.destroy();
        }

        // ------------------------------ timeout

        req.socket.setTimeout(UPLOAD_TIMEOUT);

        // ------------------------------ errors

        req.on('error', bad_request_call);
        readStream.on('error', bad_request_call);

        // ------------------------------ pipe

        res.writeHead(statusCode, headers);
        readStream.pipe(res);
    } catch (err) {
        console.log("download error", err);
        req.socket.end(bad_request);
    }
}

module.exports = {
    upload,
    download
}
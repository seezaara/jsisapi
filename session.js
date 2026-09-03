"use strict";

// ------------------------------------
// Upload Session Store
// ------------------------------------
const UPLOAD_SESSION_TTL = 20 * 60 * 1000 // give it time for listed upload
const upload_sessions = new Map()

function create_cookie_id(len = 36) {
    if ((len & 1) !== 0) len++;
    const chunks = Math.ceil(len / 12);
    let s = '';
    for (let i = 0; i < chunks; i++) {
        s += Math.floor(Math.random() * (0xffffffffffff - 0x100000000000 + 1) + 0x100000000000).toString(16).padStart(12, '0');
    }
    return s.slice(0, len);
}


function create_session(data) { 
    const token = create_cookie_id(36)
    upload_sessions.set(token, data)
    return token
}

function get_session(token, update = true) {
    if (token.length != 36)
        return
    const s = upload_sessions.get(token)
    if (!s)
        return null
    if (Date.now() - s.time > UPLOAD_SESSION_TTL) {
        upload_sessions.delete(token)
        return null
    }
    if (update)
        s.time = Date.now()
    return s
}

function delete_session(token) {
    upload_sessions.delete(token)
}

setInterval(() => {
    const now = Date.now()
    for (const [k, v] of upload_sessions) {
        if (!v || now - v.time > UPLOAD_SESSION_TTL)
            upload_sessions.delete(k)
    }
}, 60_000)


module.exports = {
    create_cookie_id,
    create_session,
    get_session,
    delete_session, 
}
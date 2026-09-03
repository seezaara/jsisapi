"use strict";

function isInt(v) {
    return Number.isInteger(v) &&
        v <= Number.MAX_SAFE_INTEGER &&
        v >= Number.MIN_SAFE_INTEGER;
}

function isFloat(v) {
    return typeof v === "number" &&
        Number.isFinite(v) &&
        v.toString().includes("e") === false;
}

function isString(v) {
    return typeof v === "string";
}

function isBool(v) {
    return typeof v === "boolean";
}

function isObject(v) {
    return v !== null && typeof v === "object" && !Array.isArray(v);
}

function toInt(v) {
    if (typeof v === "number" && Number.isInteger(v)) return v;

    if (typeof v === "string") {
        const s = v.trim();
        if (/^[+-]?\d+$/.test(s)) return parseInt(s, 10);
    }

    return undefined;
}

function toFloat(v) {
    if (typeof v === "number" && Number.isFinite(v)) return v;

    if (typeof v === "string") {
        const s = v.trim();
        if (s === "") return undefined;

        const n = Number(s);
        if (Number.isFinite(n)) return n;
    }

    return undefined;
}

function toBool(v) {
    if (typeof v === "boolean") return v;

    if (typeof v === "number") {
        if (v === 1) return true;
        if (v === 0) return false;
    }

    if (typeof v === "string") {
        const s = v.trim().toLowerCase();
        if (s === "true" || s === "1") return true;
        if (s === "false" || s === "0") return false;
    }

    return undefined;
}

function toString(v) {
    if (v === undefined || v === null) return undefined;
    return String(v);
}

function checkArrayOf(input, checkOne) {
    if (!Array.isArray(input)) return undefined;

    for (let i = 0; i < input.length; i++) {
        if (!checkOne(input[i])) return undefined;
    }

    return input;
}

function convertArrayOf(input, convertOne) {
    if (!Array.isArray(input)) return undefined;

    const out = new Array(input.length);

    for (let i = 0; i < input.length; i++) {
        const v = convertOne(input[i]);
        if (v === undefined) return undefined;
        out[i] = v;
    }

    return out;
}

function IS_INT_ARRAY(v) {
    return checkArrayOf(v, isInt);
}

function IS_FLOAT_ARRAY(v) {
    return checkArrayOf(v, isFloat);
}

function IS_STRING_ARRAY(v) {
    return checkArrayOf(v, isString);
}

function IS_BOOL_ARRAY(v) {
    return checkArrayOf(v, isBool);
}

function IS_OBJECT_ARRAY(v) {
    return checkArrayOf(v, isObject);
}


function TO_INT_ARRAY(v) {
    return convertArrayOf(v, toInt);
}

function TO_FLOAT_ARRAY(v) {
    return convertArrayOf(v, toFloat);
}

function TO_BOOL_ARRAY(v) {
    return convertArrayOf(v, toBool);
}

function TO_STRING_ARRAY(v) {
    return convertArrayOf(v, toString);
}


function UPPER(v) {
    return v.toUpperCase();
}

function LOWER(v) {
    return v.toLowerCase();
}

function TRIM(v) {
    return v.trim();
}
function CHECK_TRIM(v) {
    return v.trim().length == v.length ? v : undefined;
}

module.exports = {

    IS_INT_ARRAY,
    IS_FLOAT_ARRAY,
    IS_STRING_ARRAY,
    IS_BOOL_ARRAY,
    IS_OBJECT_ARRAY,


    TO_INT_ARRAY,
    TO_FLOAT_ARRAY,
    TO_BOOL_ARRAY,
    TO_STRING_ARRAY,

    UPPER,
    LOWER,
    TRIM,
    CHECK_TRIM,
};
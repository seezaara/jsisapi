"use strict";
const utils = require("./utils")
// ---------------------------------
// Extended type + rules checker
// ---------------------------------
const signs = {
    file: undefined,
    image: ["ffd8ff"], // jpeg 
    audio: ['494433', 'fffb', 'fff3', 'fff2'], // mp3
    video: ["0000001866747970", "0000001c66747970", "0000002066747970"], // mp4
}

function check(data, field, rule) {
    const value = data[field];
    const filter_value = rule?.[4];
    const type = rule?.[0];

    if (typeof rule == "object") {
        const min = rule[1];
        const max = rule[2];
        const required = rule[3] !== false;

        // handle required 

        if (value == null)
            return !required;

        switch (type) {

            case "int": {
                // merged: type check + finite + integer + range
                if (
                    typeof value !== "number" ||
                    !Number.isInteger(value) ||
                    value < min ||  // actualy is is <= and >= but in reverse 
                    value > max
                )
                    return false;
                break;
            }

            case "string": {
                if (
                    typeof value !== "string" ||
                    value.length < min ||
                    value.length > max
                )
                    return false;
                break;
            }

            case "float": {
                if (
                    typeof value !== "number" ||
                    !Number.isFinite(value) ||
                    value < min ||
                    value > max
                )
                    return false;
                break;
            }

            case "bool": {
                if (typeof value !== "boolean")
                    return false;
                break;
            }

            case "array": {
                if (
                    !Array.isArray(value) ||
                    value.length < min ||
                    value.length > max
                )
                    return false;
                break;
            }

            case "file":
            case "video":
            case "audio":
            case "image": {
                if (
                    typeof value !== "number" ||
                    !Number.isInteger(value) ||
                    value < min ||
                    value > max
                )
                    return false;

                data[field] = {
                    size: value,
                    sign: signs[type]
                }
                break;
            }

            default:
                return false;
        }
    }
    // custom filter_value
    if (filter_value != undefined) {
        if (typeof filter_value === "function") {
            const out = filter_value(value);
            if (out === undefined)
                return false;
            data[field] = out;
        } else if (typeof filter_value === "string") {
            if (!(filter_value in utils))
                throw "WORNG TYPE FILTER: " + filter_value
            const out = utils[filter_value](value);
            if (out === undefined)
                return false;
            data[field] = out;
        } else if (typeof filter_value === "object") {
            if (type === "array" && !Array.isArray(filter_value)) {
                for (const item of value)
                    if (typeof item !== "object" || item == null ||
                        !valid(item, filter_value))
                        return false;
            } else {
                let out = value
                for (const the_f of filter_value) {
                    if (!(the_f in utils))
                        throw "WORNG TYPE ARRAY FILTER: " + the_f
                    out = utils[the_f](out);
                    if (out === undefined)
                        return false;
                }
                data[field] = out;
            }
        }
    }
    return true;
}


function valid(data, schema) {
    for (const k in schema)
        if (!check(data, k, schema[k])) { 
            return false;
        }
    return true;
}

module.exports = {
    check,
    valid,
    signs
}
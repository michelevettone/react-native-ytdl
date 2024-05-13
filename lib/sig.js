const querystring = require("querystring");
const Cache = require("./cache");
const utils = require("./utils");
const jsWebView = require("./jsWebView");

// A shared cache to keep track of html5player js functions.
exports.cache = new Cache();

/**
 * Extract signature deciphering and n parameter transform functions from html5player file.
 *
 * @param {string} html5playerfile
 * @param {Object} options
 * @returns {Promise<Array.<string>>}
 */
exports.getFunctions = (html5playerfile, options) =>
    exports.cache.getOrSet(html5playerfile, async () => {
        const body = await utils.exposedMiniget(html5playerfile, options).text();
        const functions = exports.extractFunctions(body);
        if (!functions || !functions.length) {
            throw Error("Could not extract functions");
        }
        exports.cache.set(html5playerfile, functions);
        return functions;
    });

/**
 * Extracts the actions that should be taken to decipher a signature
 * and tranform the n parameter
 *
 * @param {string} body
 * @returns {Array.<string>}
 */
exports.extractFunctions = (body) => {
    const functions = [];
    const extractManipulations = (caller) => {
        const functionName = utils.between(caller, `a=a.split("");`, `.`);
        if (!functionName) return "";
        const functionStart = `var ${functionName}={`;
        const ndx = body.indexOf(functionStart);
        if (ndx < 0) return "";
        const subBody = body.slice(ndx + functionStart.length - 1);
        return `var ${functionName}=${utils.cutAfterJSON(subBody)}`;
    };
    const extractDecipher = () => {
        const functionName = utils.between(body, `a.set("alr","yes");c&&(c=`, `(decodeURIC`);
        if (functionName && functionName.length) {
            const functionStart = `${functionName}=function(a)`;
            const ndx = body.indexOf(functionStart);
            if (ndx >= 0) {
                const subBody = body.slice(ndx + functionStart.length);
                let functionBody = `var ${functionStart}${utils.cutAfterJSON(subBody)}`;
                functionBody = `${extractManipulations(
                    functionBody
                )};${functionBody};${functionName}(sig);`;
                functions.push(functionBody);
            }
        }
    };
    const extractNCode = () => {
        let functionName = utils.between(body, `&&(b=a.get("n"))&&(b=`, `(b)`);
        if (functionName.includes("["))
            functionName = utils.between(body, `${functionName.split("[")[0]}=[`, `]`);
        if (functionName && functionName.length) {
            const functionStart = `${functionName}=function(a)`;
            const ndx = body.indexOf(functionStart);
            if (ndx >= 0) {
                const subBody = body.slice(ndx + functionStart.length);
                const functionBody = `var ${functionStart}${utils.cutAfterJSON(
                    subBody
                )};${functionName}(ncode);`;
                functions.push(functionBody);
            }
        }
    };
    extractDecipher();
    extractNCode();
    return functions;
};

/**
 * Apply decipher and n-transform to individual format
 *
 * @param {Object} format
 * @param {string} decipherScript
 * @param {string} nTransformScript
 */
exports.setDownloadURL = (format, decipherScript, nTransformScript, options = null) => {
    const decipher = (url) => {
        const args = querystring.parse(url);
        if (!args.s || !decipherScript) return args.url;
        const components = new URL(decodeURIComponent(args.url));

        options.webViewRef.current.injectJavaScript(
            jsWebView.getScript("sig", {
                decipherScript: decipherScript,
                sig: args.s,
                sp: args.sp
            })
        );

        //components.searchParams.set(args.sp ? args.sp : "signature", sigFinal);
        return components.toString();
    };
    const ncode = (url) => {
        const components = new URL(decodeURIComponent(url));
        const n = components.searchParams.get("n");
        if (!n || !nTransformScript) return url;

        options.webViewRef.current.injectJavaScript(
            jsWebView.getScript("ncode", {
                nTransformScript: nTransformScript,
                n: n
            })
        );
        //components.searchParams.set("n", ncodeFinal);
        return components.toString();
    };
    const cipher = !format.url;
    const url = format.url || format.signatureCipher || format.cipher;
    format.url = cipher ? ncode(decipher(url)) : ncode(url);
    delete format.signatureCipher;
    delete format.cipher;
};

/**
 * Applies decipher and n parameter transforms to all format URL's.
 *
 * @param {Array.<Object>} formats
 * @param {string} html5player
 * @param {Object} options
 */
exports.decipherFormats = async (formats, html5player, options) => {
    let decipheredFormats = {};
    let functions = await exports.getFunctions(html5player, options);
    const decipherScript = functions.length ? functions[0] : null;
    const nTransformScript = functions.length > 1 ? functions[1] : null;
    formats.forEach((format) => {
        exports.setDownloadURL(format, decipherScript, nTransformScript, options);
        decipheredFormats[format.url] = format;
    });
    return decipheredFormats;
};
const bcrypt = require("bcrypt");
const nonce = require("nonce")(10);

// Salt should be looked up from the DB and sent to the client
let salt = bcrypt.genSaltSync();
let serverPwHash = bcrypt.hashSync("hellothere", salt);
let clientPwHash = bcrypt.hashSync("hellothere", salt);

let cnonce = nonce();
let snonce = nonce();

// Client generates their nonce hash
let clientNonceHash = bcrypt.hashSync(`${snonce}${cnonce}${clientPwHash}`, 10);

// Client sends the hash to the server, server looks up its nonce & rejects if the server nonce has already been used
// Assume nonce is valid, server accepts client nonce and nonce hash

let passwordValid = bcrypt.compareSync(`${snonce}${cnonce}${serverPwHash}`, clientNonceHash);
console.log(`Password was valid: ${passwordValid}`);

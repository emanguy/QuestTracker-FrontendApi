const bcrypt = require("bcrypt");
const nonce = require("nonce")(10);
const fetch = require("node-fetch");
const HttpStatus = require("http-status-codes");
const dotenv = require("dotenv");
dotenv.load();

const USERNAME = "add username here";
const PASSWORD = "add password here";

(async function() {
    // Grab a nonce/salt pair for a user. Make sure your .env file has the PROCESS_PORT set to 8080
    const response = await fetch(`http://localhost:${process.env.PROCESS_PORT}/auth/${USERNAME}/nonce`);

    // If the server responds with a 404, it means the user doesn't exist. Provide a document for convenience.
    if (response.status === HttpStatus.NOT_FOUND) {
        console.log("User was not found. Add the following document into your MongoDB: ");
        const salt = bcrypt.genSaltSync();
        const hash = bcrypt.hashSync(PASSWORD, salt);
        const userEntry = {username: USERNAME, passwordSalt: salt, passwordHash: hash};
        console.log(JSON.stringify(userEntry));
        return;
    }

    // With the nonce/salt pair, generate the nonce-hash to send to the server
    const {nonce: {id, serverNonce}, passwordSalt} = await response.json();
    const clientNonce = nonce();
    const completePasswordHash = bcrypt.hashSync(PASSWORD, passwordSalt);
    const rawMessageToTransmit = `${serverNonce}${clientNonce}${completePasswordHash}`;
    const clientPasswordHash = bcrypt.hashSync(rawMessageToTransmit, 10);

    // Request login token with nonce-hash
    const authRequest = {clientNonce, clientPasswordHash, serverNonceId: id};
    const loginTokenResponse = await fetch(`http://localhost:${process.env.PROCESS_PORT}/auth/${USERNAME}/login`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(authRequest)
    });

    // Retrieve login token, log it if successful. Otherwise, log error message.
    if (loginTokenResponse.status === HttpStatus.CREATED) {
        const token = await loginTokenResponse.json();
        console.log(`Success. Your login token is: ${token.loginToken}`);
    }
    else {
        const error = await loginTokenResponse.json();
        console.log(`Login failed. Code: ${loginTokenResponse.status} error message: ${JSON.stringify(error)}`);
    }
})();


import * as nonce from "nonce";
import {compareSync} from "bcrypt";
import {UserCollectionConnector} from "../connectors/MongoConnector";
import {RedisConnector} from "../connectors/RedisConnector";
import {SavedNonce} from "../interfaces/AuthInterfaces";

export class AuthFailureError extends Error {
    private username: string;

    constructor(message: string, username: string) {
        super(message);
        this.username = username;
    }
}

export class NoUserFoundError extends Error {
    private username: string;

    constructor(message: string, username: string) {
        super(message);
        this.username = username;
    }
}

export class NonceExpiredError extends Error {
    private username: string;
    private nonceId: string;

    constructor(message: string, username: string, nonceId: string) {
        super(message);
        this.username = username;
        this.nonceId = nonceId;
    }
}

export default class AdminLoginService {
    private mongoConnector : UserCollectionConnector;
    private redisConnector: RedisConnector;
    private nonceGenerator: () => number;

    constructor(mongoConnector: UserCollectionConnector, redisConnector: RedisConnector) {
        this.mongoConnector = mongoConnector;
        this.redisConnector = redisConnector;
        this.nonceGenerator = nonce();
    }

    /**
     * Creates and caches a nonce that a client can use for login
     */
    retrieveNonceForLogin() : SavedNonce {
        const serverNonce = this.nonceGenerator();
        const id = this.redisConnector.saveServerNonce(serverNonce);
        return {id, serverNonce};
    }

    /**
     * Get the salt for a given user
     *
     * @param username The username to look up
     * @throws NoUserFoundError if the specified user was not found
     * @return The salt used for this user's password hash
     */
    async getUserSalt(username: string) : Promise<string> {
        const user = await this.mongoConnector.getUser(username);
        if (user === null) throw new NoUserFoundError("Could not find user!", username);
        return user.passwordSalt;
    }

    /**
     * Get an access token for an attempted login.
     *
     * @param username The user trying to log in
     * @param clientPasswordHash The hash generated on the client side for attempted login
     * @param serverNonceId The ID of the nonce the server generated
     * @param clientNonce The client's generated nonce
     * @throws NoUserFoundError if the user doesn't exist
     * @throws NonceExpiredError if the generated server nonce is too old
     * @throws AuthFailureError if the password hash failed to match what was stored in the DB
     * @return A login token for the user if the password hash matches
     */
    async getAccessToken(username: string, clientPasswordHash: string, serverNonceId: string, clientNonce: number) : Promise<string> {
        const serverNoncePromise = this.redisConnector.getServerNonce(serverNonceId);
        const userPromise = this.mongoConnector.getUser(username);

        // Find user in DB, fail if not found
        const resolvedUser = await userPromise;
        if (resolvedUser === null) {
            this.redisConnector.invalidateServerNonce(serverNonceId);
            throw new NoUserFoundError("Auth could not find user.", username);
        }

        // Find previously generated nonce with ID, fail if expired or missing
        const resolvedServerNonce = await serverNoncePromise;
        if (resolvedServerNonce === null) throw new NonceExpiredError("Server nonce was expired.", username, serverNonceId);

        // Verify client password hash matches expected based on nonces, fail on mismatch
        const validLogin = compareSync(`${resolvedServerNonce}${clientNonce}${resolvedUser.passwordHash}`, clientPasswordHash);
        // Server nonce is used at this point, invalidate to prevent replay attack
        this.redisConnector.invalidateServerNonce(serverNonceId);
        if (!validLogin) {
            throw new AuthFailureError("Could not log in with provided credentials.", username);
        }
        else {
            // Login success, return login token
            return this.redisConnector.addOrRefreshLoginToken(username);
        }
    }

    /**
     * Checks to see whether a username, token combination is valid and resets the token expiration
     * if it is.
     *
     * @param username The user
     * @param token The token given to the user
     * @return True if the username, token combination is valid
     */
    async checkLoginValidityAndResetExpiration(username: string, token: string) : Promise<boolean> {
        const tokenValid = await this.redisConnector.loginTokenValid(username, token);
        if (tokenValid) this.redisConnector.addOrRefreshLoginToken(username, token);
        return tokenValid;
    }

    logOut(username: string, token: string) {
        this.redisConnector.invalidateLoginToken(username, token);
    }
}
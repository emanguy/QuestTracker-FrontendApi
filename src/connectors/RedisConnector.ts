import {createClient, RedisClient} from "redis";
import {Configuration} from "../config";
import {v4 as uuid} from "uuid";
import * as log from "winston";

export class RedisConnector {
    private client:RedisClient;

    private RECONNECT_WAIT_TIME = 10000;
    private DEFAULT_NONCE_EXPIRATION_TIME = 120;
    private DEFAULT_LOGIN_TOKEN_EXPIRATION_TIME = 1800;

    constructor(config: Configuration) {
        if (!config.redis.password) {
            throw new Error("Tried to connect to redis without a password!");
        }

        this.client = createClient(config.redis.url, {
            password: config.redis.password,
            retry_strategy: (options) => {
                if (options.attempt > 12) {
                    log.error("Lost connection with redis after 12 attempts! Shutting down server.");
                    return Error("Could not connect to redis after 12 attempts.");
                }

                return this.RECONNECT_WAIT_TIME;
            }
        });

        log.info("Connected to redis.");
    }

    disconnect() {
        this.client.quit();
    }

    /**
     * Saves a nonce and retrieves a unique identifier for the nonce in the cache
     *
     * @param nonce The nonce to save
     * @param expirationTimeSeconds How long the nonce should last in the cache
     * @return The unique identifier for the nonce for lookup later
     */
    saveServerNonce(nonce: number, expirationTimeSeconds: number = this.DEFAULT_NONCE_EXPIRATION_TIME) : string {
        const nonceIdentifier = uuid();
        this.client.setex(`nonce:${nonceIdentifier}`, expirationTimeSeconds, nonce.toString());
        return nonceIdentifier;
    }

    invalidateServerNonce(nonceId: string) {
        this.client.del(`nonce:${nonceId}`);
    }

    /**
     * Retrieve a saved server nonce from Redis
     * @param nonceId The identifier of the nonce to retrieve
     * @return The nonce for the given ID, or null if nothing could be found
     */
    async getServerNonce(nonceId: string) : Promise<number|null> {
        return new Promise<number|null>((resolve) => {
            this.client.get(`nonce:${nonceId}`, (err, reply) => {
                if (err || reply === null) resolve(null);
                else resolve(+reply);
            })
        });
    }

    addOrRefreshLoginToken(username: string, tokenToRefresh?: string, tokenExpirationSeconds: number = this.DEFAULT_LOGIN_TOKEN_EXPIRATION_TIME) : string {
        if (!tokenToRefresh) tokenToRefresh = uuid();
        this.client.setex(`loginToken:${username}:${tokenToRefresh}`, tokenExpirationSeconds, "logged in");
        return tokenToRefresh;
    }

    invalidateLoginToken(username: string, token: string) {
        this.client.del(`loginToken:${username}:${token}`);
    }

    async loginTokenValid(username: string, token: string) : Promise<boolean> {
        return new Promise<boolean>((resolve) => {
            this.client.get(`loginToken:${username}:${token}`, (err, reply) => {
                if (err || reply === null) resolve(false);
                else resolve(true);
            });
        })
    }
}
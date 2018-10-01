import {createClient, RedisClient} from "redis";
import config, {Configuration} from "../config";
import {v4 as uuid} from "uuid";
import log from "../logger";
import {GenericAdd, GenericDeletion, GenericUpdate} from "common-interfaces/QuestInterfaces";

let redisConnection: RedisClient|null = null;
let redisAuthConnectorInstance: RedisAuthConnector|null = null;
let redisUpdateConnectorInstance: RedisUpdateConnector|null = null;

function redisConnectionSingleton(config: Configuration) {
    if (redisConnection) return redisConnection;
    const reconnectTime = 10000;

    if (!config.redis.password) {
        throw new Error("Tried to connect to redis without a password!");
    }

    redisConnection = createClient(config.redis.url, {
        password: config.redis.password,
        retry_strategy: (options) => {
            if (options.attempt > 12) {
                log.error("Lost connection with redis after 12 attempts! Shutting down server.");
                return Error("Could not connect to redis after 12 attempts.");
            }

            return reconnectTime;
        }
    });

    log.info("Connected to redis.");
    return redisConnection;
}

export class RedisUpdateConnector {
    private client: RedisClient;

    private ADD_CHANNEL = "new-quests";
    private UPDATE_CHANNEL = "quest-updates";
    private REMOVE_CHANNEL = "removed-quests";

    constructor(clientInstance: RedisClient) {
        this.client = clientInstance;
    }

    pushAdd(add: GenericAdd) {
        this.client.publish(this.ADD_CHANNEL, JSON.stringify(add));
    }

    pushUpdate(update: GenericUpdate) {
        this.client.publish(this.UPDATE_CHANNEL, JSON.stringify(update));
    }

    pushRemoval(removal: GenericDeletion) {
        this.client.publish(this.REMOVE_CHANNEL, JSON.stringify(removal));
    }
}

export class RedisAuthConnector {
    private client:RedisClient;

    private DEFAULT_NONCE_EXPIRATION_TIME = 120;
    private DEFAULT_LOGIN_TOKEN_EXPIRATION_TIME = 1800;

    constructor(redisClient: RedisClient) {
        this.client = redisClient;
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

export default {
    authConnectorInstance: function(): RedisAuthConnector {
        if (!redisAuthConnectorInstance) {
            const client = redisConnectionSingleton(config);
            redisAuthConnectorInstance = new RedisAuthConnector(client);
        }

        return redisAuthConnectorInstance;
    },
    updateConnectorInstance: function(): RedisUpdateConnector {
        if (!redisUpdateConnectorInstance) {
            const client = redisConnectionSingleton(config);
            redisUpdateConnectorInstance = new RedisUpdateConnector(client);
        }

        return redisUpdateConnectorInstance;
    }
}
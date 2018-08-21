import * as dotenv from "dotenv";

dotenv.config();

export interface Configuration {
    applicationPort: string | number
    mongo: {
        hostname: string
        port: number
        baseDatabase: string
        credentials: {
            username: string
            password?: string
        }
    }
    redis: {
        url: string
        password?: string
    }
}

const config:Configuration = {
    applicationPort: process.env["PROCESS_PORT"] || 80,
    mongo: {
        hostname: process.env["MONGO_HOSTNAME"] || "localhost",
        port: +(process.env["MONGO_PORT"] || 27017),
        baseDatabase: process.env["MONGO_DB_NAME"] || "quest-tracker",
        credentials: {
            username: process.env["MONGO_DB_USER"] || "aragashion",
            password: process.env["MONGO_DB_PASSWORD"]
        }
    },
    redis: {
        url: process.env["REDIS_CONNECTION_STRING"] || "redis://localhost:6379",
        password: process.env["REDIS_PASSWORD"]
    }
};

if (!config.mongo.credentials.password) {
    throw new Error("Env did not provide MongoDB password!");
}

if (!config.redis.password) {
    throw new Error("Env did not provide Redis password!");
}

export default config;
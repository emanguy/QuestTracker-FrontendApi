import {Configuration} from "../src/config";

export default <Configuration> {
    applicationPort: 8000,
    mongo: {
        hostname: "127.0.0.1",
        port: 27017,
        baseDatabase: "quest-tracker",
        credentials: {
            username: "aragashion",
            password: "password"
        }
    }
};
import * as express from "express";
import {Response} from "express";
import log from "./logger";
import config from "./config";
import * as morgan from "morgan";
import authControllerPromise from "./controllers/AuthController";
import questCrudControllerPromise from "./controllers/QuestCrudController";
import * as cors from "cors";

async function main() {
    const app = express();
    const pendingAuthPromise = authControllerPromise();
    const pendingQuestPromise = questCrudControllerPromise();

    if (config.environment !== "production") {
        app.use(cors());
    }

    app.use(morgan("common"));
    app.get("/", (_, res:Response) => { res.status(200).send(`Quest tracker primary API service -- version ${process.env.npm_package_version}`);
    });

    app.use("/auth", await pendingAuthPromise);
    app.use("/quests", await pendingQuestPromise);

    app.listen(config.applicationPort, () => log.info(`App is running on port ${config.applicationPort}!`));
}

main();

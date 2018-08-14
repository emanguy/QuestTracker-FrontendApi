import * as express from "express";
import {Response} from "express";
import * as log from "winston";
import config from "./config";

const app = express();

app.get("/", (_, res:Response) => {
    res.status(200).send(`Quest tracker primary API service -- version ${process.env.npm_package_version}`);
});

app.listen(config.applicationPort, () => log.info(`App is running on port ${config.applicationPort}!`));


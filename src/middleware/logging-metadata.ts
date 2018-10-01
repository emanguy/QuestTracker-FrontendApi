import {NextFunction, Request, Response} from "express";

interface LogMetadata {
    route:string
    body?:object
}

export interface WinstonRequest extends Request {
    winstonMetadata:LogMetadata
}

const metadataMiddleware = function(req:WinstonRequest, res:Response, next:NextFunction) {
    req.winstonMetadata = { route: req.path };
    if (req.body) {
        req.winstonMetadata.body = req.body;
    }

    next();
};

export default metadataMiddleware;

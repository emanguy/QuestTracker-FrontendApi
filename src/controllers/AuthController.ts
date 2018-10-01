import {NextFunction, Response, Router} from "express";
import loginServiceInstance, {
    AdminLoginService,
    AuthFailureError,
    NonceExpiredError,
    NoUserFoundError
} from "../services/AdminLoginService";
import metadataMiddleware, {WinstonRequest} from "../middleware/logging-metadata";
import {AccessTokenRequest, isAccessTokenRequest, LoginToken, NonceSaltPair} from "common-interfaces/AuthInterfaces";
import {ErrorDescription, UnknownErrorDescription} from "common-interfaces/RestResponses";
import {json as jsonParser} from "body-parser";
import log from "../logger";
import * as HttpStatus from "http-status-codes";
import * as asyncHandler from "express-async-handler";

const authController = Router();
let controllerInitialized = false;
let authService: AdminLoginService|null = null;

function verifyAuthServiceExists(authService: AdminLoginService|null|undefined) {
    return asyncHandler(function(req: WinstonRequest, res: Response, next: NextFunction) {
        if (!authService) {
            log.error("Auth service is null and should not be!", req.winstonMetadata);
            res.sendStatus(HttpStatus.INTERNAL_SERVER_ERROR);
        }
        else {
            next();
        }
    });
}

async function initController() {
    authService = await loginServiceInstance();
    authController.use(metadataMiddleware, verifyAuthServiceExists(authService));

    // TODO add validation to these endpoints
    authController.get("/:userId/nonce", asyncHandler(async (req: WinstonRequest, res: Response) => {

        log.info("User requested new nonce.", req.winstonMetadata);

        if (authService == null) {
            log.error("WTF -- the nullability middleware failed");
            return;
        }
        if (!req.params.userId) {
            log.warn("User sent bad user ID");
            res.sendStatus(HttpStatus.BAD_REQUEST);
            return;
        }

        const snonce = authService.retrieveNonceForLogin();
        const userSalt = authService.getUserSalt(req.params.userId);

        try {
            const responseBody: NonceSaltPair = {
                nonce: snonce,
                passwordSalt: await userSalt // Could throw NoUserFoundError
            };

            res.status(HttpStatus.OK).json(responseBody);
            return;
        }
        catch (e) {
            if (e instanceof NoUserFoundError) {
                const returnedError: ErrorDescription = { message: `Username not found: ${req.params.userId}` };
                log.warn(`Sending 404 response. User not found: ${req.params.userId}`);
                res.status(HttpStatus.NOT_FOUND).json(returnedError);
                return;
            }
            else {
                log.error("Unknown error occurred. Detail enclosed.", { error: e });
                const returnedError: UnknownErrorDescription = {
                    message: "Unknown error occurred.",
                    unknownErrorMessage: e.message || "No message given"
                };
                res.status(HttpStatus.INTERNAL_SERVER_ERROR).json(returnedError);
                return;
            }
        }
    }));

    /**
     * Accepts an {@link AccessTokenRequest}, validates it, and hands back a token
     */
    authController.post("/:userId/login",
        jsonParser(),
        asyncHandler(async (req: WinstonRequest, res: Response) => {

        log.info("User requested login token.", req.winstonMetadata);

        if (!authService) {
            log.error("WTF -- auth service does not exist when it should");
            return;
        }
        if (!req.params.userId) {
            log.warn("Did not receive a user ID.");
            const response: ErrorDescription = {message: "No user ID provided."};
            res.status(HttpStatus.BAD_REQUEST).json(response);
            return;
        }
        if (!isAccessTokenRequest(req.body)) {
            log.warn("Received bad login token request.", { badRequest: req.body });
            const response: ErrorDescription = {message: "Required request fields were partially or fully missing."};
            res.status(HttpStatus.BAD_REQUEST).json(response);
            return;
        }

        const tokenRequest: AccessTokenRequest = req.body;

        try {
            const loginToken = await authService.getAccessToken(req.params.userId, tokenRequest.clientPasswordHash, tokenRequest.serverNonceId, tokenRequest.clientNonce);
            const response: LoginToken = {loginToken};
            res.status(HttpStatus.CREATED).json(response);
        }
        catch (e) {
            if (e instanceof NoUserFoundError) {
                log.warn(`User not found: ${e.username}. Error message: ${e.message}`);
                const response: ErrorDescription = {message: "Provided user not found."};
                res.status(HttpStatus.NOT_FOUND).json(response);
                return;
            }

            if (e instanceof NonceExpiredError) {
                log.warn(`User ${e.username} tried to log in with expired nonce: ${e.nonceId}. Error message: ${e.message}`);
                const response: ErrorDescription = {message: "Provided nonce is expired."};
                res.status(HttpStatus.BAD_REQUEST).json(response);
                return;
            }

            if (e instanceof AuthFailureError) {
                log.warn(`Authentication failed for user ${e.username}. Error message: ${e.message}`);
                const response: ErrorDescription = {message: "Authentication failure."};
                res.status(HttpStatus.FORBIDDEN).json(response);
                return;
            }

            log.error("Unknown error occurred. Attaching error.", { error: e });
            const returnedError: UnknownErrorDescription = {
                message: "An unknown error occurred.",
                unknownErrorMessage: e.message
            };
            res.status(HttpStatus.INTERNAL_SERVER_ERROR).json(returnedError);
            return;
        }
    }));

    /**
     * Does what you'd expect -- deletes the login token, hence logging the user out.
     */
    authController.delete("/:userId/token/:loginToken", (req: WinstonRequest, res: Response) => {
       log.info("User logged out.", req.winstonMetadata);

       if (!authService) {
           log.error("WTF -- nullability middleware didn't work");
           res.sendStatus(HttpStatus.INTERNAL_SERVER_ERROR);
           return;
       }
       if (!req.params.userId || !req.params.loginToken) {
           log.warn("User did not provide username or login token.");
           const response: ErrorDescription = {message: "Username or login token missing."};
           res.status(HttpStatus.BAD_REQUEST).json(response);
           return;
       }

       authService.logOut(req.params.userId, req.params.loginToken);
       res.sendStatus(HttpStatus.ACCEPTED);
    });

    controllerInitialized = true;
}

export default async function(): Promise<Router> {
    if (!controllerInitialized) await initController();
    return authController;
}

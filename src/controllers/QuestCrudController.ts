import {NextFunction, Response, Router} from "express";
import authServiceInstance, {AdminLoginService} from "../services/AdminLoginService";
import mongoInstances, {EmptyUpdateError, QuestCollectionConnector} from "../connectors/MongoConnector";
import redisInstances, {RedisUpdateConnector} from "../connectors/RedisConnector";
import metadataMiddleware, {WinstonRequest} from "../middleware/logging-metadata";
import {ErrorDescription, NewlyCreatedDescription, UnknownErrorDescription} from "common-interfaces/RestResponses";
import config from "../config";
import {isArray} from "util";
import {json as jsonParser} from "body-parser";
import * as uuid from "uuid/v4";
import * as HttpStatus from "http-status-codes";
import log from "../logger";
import * as asyncHandler from "express-async-handler";
import {
    GenericAdd,
    GenericDeletion,
    GenericUpdate,
    HierarchyLevel,
    Objective,
    ObjectiveUpdate,
    Quest
} from "common-interfaces/QuestInterfaces";

const crudController = Router();
let authService: AdminLoginService|null = null;
let questConnector: QuestCollectionConnector|null = null;
let updateConnector: RedisUpdateConnector|null = null;
let controllerInitialized = false;

function verifyAuthorization(authService: AdminLoginService) {
    return asyncHandler(async function(req: WinstonRequest, res: Response, next: NextFunction) {
        const username = req.headers["x-username"];
        const authToken = req.headers["x-auth-token"];

        if (!authToken || !username || isArray(username) || isArray(authToken)) {
            log.warn("Authorization or username not provided for path.", req.winstonMetadata);
            const response: ErrorDescription = {message: "Missing auth token or username header."};
            res.status(HttpStatus.BAD_REQUEST).json(response);
            return;
        }

        if (await authService.checkLoginValidityAndResetExpiration(username, authToken)) {
            next();
        }
        else {
            log.warn("Invalid authorization.", { username, authToken, winstonMetadata: req.winstonMetadata });
            const response: ErrorDescription = {message: "Bad login credentials."};
            res.status(HttpStatus.FORBIDDEN).json(response);
            return;
        }
    });
}

function connectorExists(connector: AdminLoginService|QuestCollectionConnector|RedisUpdateConnector|null|undefined) {
    return function(req: WinstonRequest, res: Response, next: NextFunction) {
        if (!connector) {
            log.error("Middleware did not exist when it should have.", req.winstonMetadata);
            res.sendStatus(HttpStatus.INTERNAL_SERVER_ERROR);
            return;
        }
        else {
            next();
        }
    }
}

// TODO add validation to these endpoints
async function initController() {
    const authPromise = authServiceInstance();
    const questConnPromise = mongoInstances.questCollectionConnectorInstance(config);
    const updateConnPromise = redisInstances.updateConnectorInstance();

    authService = await authPromise;
    questConnector = await questConnPromise;
    updateConnector = await updateConnPromise;

    crudController.use(metadataMiddleware, connectorExists(authService), connectorExists(questConnector), connectorExists(updateConnector));
    const verifyAndParse = [verifyAuthorization(authService), jsonParser()];

    /**
     * Retrieves all quests
     */
    crudController.get("/", asyncHandler(async (req: WinstonRequest, res: Response) => {
        log.info("User requested all quests.", req.winstonMetadata);

        if (!questConnector) {
            log.error("WTF -- nullability middleware failed!");
            res.sendStatus(HttpStatus.INTERNAL_SERVER_ERROR);
            return;
        }

        res.status(200).json(await questConnector.getQuests());
    }));

    /**
     * Create a new quest with a {@link RestBodyQuest}
     */
    crudController.post("/", verifyAndParse, asyncHandler(async (req: WinstonRequest, res: Response) => {

            log.info("Admin added a new quest.", {quest: req.body, winstonMetadata: req.winstonMetadata});

            if (!questConnector || !updateConnector) {
                log.error("WTF -- nullability middleware didn't work!");
                res.sendStatus(HttpStatus.INTERNAL_SERVER_ERROR);
                return;
            }

            // Apply uuid to quest, should be type RestBodyQuest initially
            req.body.id = uuid();
            const newQuest: Quest = req.body;

            const completedSuccessfully = await questConnector.addQuest(newQuest);

            if (completedSuccessfully) {
                const newAdd: GenericAdd = {
                    type: HierarchyLevel.QUEST,
                    newData: newQuest
                };

                updateConnector.pushAdd(newAdd);

                const response: NewlyCreatedDescription = {id: newQuest.id};
                res.status(HttpStatus.CREATED).json(response);
                return;
            }
            else {
                log.error("Mongo add didn't complete successfully!");
                const response: ErrorDescription = {message: "Query didn't quite work."};
                res.status(HttpStatus.BAD_GATEWAY).json(response);
                return;
            }
    }));

    /**
     * Add a new objective with a {@link RestBodyObjective}
     */
    crudController.post("/:questId/objectives", verifyAndParse, asyncHandler(async (req: WinstonRequest, res: Response) => {
            log.info("Admin created a new objective.", {objective: req.body, winstonMetadata: req.winstonMetadata});

            if (!questConnector || !updateConnector) {
                log.error("WTF -- nullability middleware failed!");
                res.sendStatus(HttpStatus.INTERNAL_SERVER_ERROR);
                return;
            }
            if (!req.params.questId) {
                log.warn("User did not provide quest ID.");
                const response: ErrorDescription = {message: "No quest ID passed."};
                res.status(HttpStatus.BAD_REQUEST).json(response);
                return;
            }

            // Apply uuid to request, should be type RestBodyObjective initially
            req.body.id = uuid();
            const newObjective: Objective = req.body;

            const updateResult = await questConnector.addObjective(req.params.questId, newObjective);

            if (updateResult.documentExisted && updateResult.updateSucceeded) {
                const newAdd: GenericAdd = {
                    questId: req.params.questId,
                    type: HierarchyLevel.OBJECTIVE,
                    newData: req.body
                };

                updateConnector.pushAdd(newAdd);
                const response: NewlyCreatedDescription = {id: req.body.id};
                res.status(HttpStatus.CREATED).json(response);
                return;
            }
            else if (!updateResult.documentExisted && updateResult.updateSucceeded) {
                log.warn(`Quest ${req.params.questId} could not be found so objective was not added.`);
                const response: ErrorDescription = {message: "Specified quest not found."};
                res.status(HttpStatus.NOT_FOUND).json(response);
                return;
            }
            else {
                log.error("Mongo didn't add the objective successfully.");
                const response: ErrorDescription = {message: "DB query didn't work."};
                res.status(HttpStatus.BAD_GATEWAY).json(response);
                return;
            }
    }));

    /**
     * Update a quest with a {@link RestBodyQuestUpdate}
     */
    crudController.put("/:questId", verifyAndParse, asyncHandler(async (req: WinstonRequest, res: Response) => {
           log.info("Admin updated a quest.", {questUpdate: req.body, winstonMetadata: req.winstonMetadata} );

           if (!questConnector || !updateConnector) {
               log.error("WTF -- nullability middleware failed!");
               res.sendStatus(HttpStatus.INTERNAL_SERVER_ERROR);
               return;
           }
           if (!req.params.questId) {
               log.warn("User did not provide quest ID.");
               const response: ErrorDescription = {message: "No quest ID passed."};
               res.status(HttpStatus.BAD_REQUEST).json(response);
               return;
           }

           // Fulfill interface w/ path params
           req.body.id = req.params.questId;

           try {
               const updateResult = await questConnector.updateQuest(req.body);

               if (updateResult.documentExisted && updateResult.updateSucceeded) {
                   const update: GenericUpdate = {
                       type: HierarchyLevel.QUEST,
                       updateDetail: req.body
                   };

                   updateConnector.pushUpdate(update);
                   res.sendStatus(HttpStatus.ACCEPTED);
                   return;
               }
               else if (!updateResult.documentExisted && updateResult.updateSucceeded) {
                   log.error(`Quest ${req.params.questId} could not be found.`);
                   const response: ErrorDescription = {message: "Specified quest could not be found."};
                   res.status(HttpStatus.NOT_FOUND).json(response);
                   return;
               }
               else {
                   log.error("Mongo didn't update the quest!");
                   const response: ErrorDescription = {message: "DB update failed!"};
                   res.status(HttpStatus.BAD_GATEWAY).json(response);
                   return;
               }
           }
           catch (e) {
               if (e instanceof EmptyUpdateError) {
                    log.warn("User didn't send any valid update properties.");
                    const response: ErrorDescription = {message: `Valid update properties were missing. Detail: ${e.message}`};
                    res.status(HttpStatus.BAD_REQUEST).json(response);
                    return;
               }
               else {
                    log.error("Unknown error occurred!", {error: e});
                    const response: UnknownErrorDescription = {
                        message: "Unknown error occurred trying to update quest.",
                        unknownErrorMessage: e.message
                    };
                    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json(response);
                    return;
               }
           }
    }));

    /**
     * Update an objective with a {@link RestBodyObjectiveUpdate}
     */
    crudController.put("/:questId/objectives/:objectiveId", verifyAndParse, asyncHandler(async (req: WinstonRequest, res: Response) => {
        log.info("Admin updated an objective.", {
            quest: req.params.questId,
            objective: req.params.objectiveId,
            winstonMetadata: req.winstonMetadata}
        );

        if (!questConnector || !updateConnector) {
            log.error("WTF?? Nullability middleware failed!");
            res.sendStatus(HttpStatus.INTERNAL_SERVER_ERROR);
            return;
        }
        if (!req.params.questId || !req.params.objectiveId) {
            log.warn("User did not send quest ID or objective ID.");
            const response: ErrorDescription = {message: "Quest ID or objective ID not sent."};
            res.status(HttpStatus.BAD_REQUEST).json(response);
            return;
        }

        // Fulfill interface w/path params,
        req.body.questId = req.params.questId;
        req.body.objectiveId = req.params.objectiveId;
        const objectiveUpdate: ObjectiveUpdate = req.body;

        try {
            const updateResult = await questConnector.updateObjective(objectiveUpdate);

            if (updateResult.documentExisted && updateResult.updateSucceeded) {
                const update: GenericUpdate = {
                    type: HierarchyLevel.OBJECTIVE,
                    updateDetail: objectiveUpdate
                };

                updateConnector.pushUpdate(update);
                res.sendStatus(HttpStatus.ACCEPTED);
                return;
            }
            else if (!updateResult.documentExisted && updateResult.updateSucceeded) {
                log.warn(`Quest ${objectiveUpdate.questId} with objective ${objectiveUpdate.objectiveId} could not be found.`);
                const response: ErrorDescription = {message: "Target objective or quest for update did not exist."};
                res.status(HttpStatus.NOT_FOUND).json(response);
                return;
            }
            else {
                log.error("DB query failed!");
                const response: ErrorDescription = {message: "DB update failed!"};
                res.status(HttpStatus.BAD_GATEWAY).json(response);
                return;
            }
        }
        catch (e) {
            if (e instanceof EmptyUpdateError) {
                log.warn("User did not provide any acceptable update fields.");
                const response: ErrorDescription = {message: "No acceptable update fields provided in request."};
                res.status(HttpStatus.BAD_REQUEST).json(response);
                return;
            }
            else {
                log.error("Unknown error occurred!", {error: e});
                const response: UnknownErrorDescription = {
                    message: "An unknown error occurred while trying to update the objective.",
                    unknownErrorMessage: e.message
                };
                res.status(HttpStatus.INTERNAL_SERVER_ERROR).json(response);
                return;
            }
        }
    }));

    /**
     * Delete a quest by ID from the database
     */
    crudController.delete("/:questId", verifyAuthorization(authService), asyncHandler(async (req: WinstonRequest, res: Response) => {
        log.info("Admin deleted a quest.", {quest: req.params.questId, winstonMetadata: req.winstonMetadata});

        if (!questConnector || !updateConnector) {
            log.error("WTF?? Nullability middleware failed!");
            res.sendStatus(HttpStatus.INTERNAL_SERVER_ERROR);
            return;
        }
        if (!req.params.questId) {
            log.warn("User did not send quest ID.");
            const response: ErrorDescription = {message: "Quest ID to delete not provided."};
            res.sendStatus(HttpStatus.BAD_REQUEST).json(response);
            return;
        }

        const success = await questConnector.deleteQuest(req.params.questId);

        if (success) {
            const deletionUpdate: GenericDeletion = {
                type: HierarchyLevel.QUEST,
                id: req.params.questId
            };

            updateConnector.pushRemoval(deletionUpdate);

            res.sendStatus(HttpStatus.ACCEPTED);
            return;
        }
        else {
            log.warn("Deletion from DB failed.");
            const response: ErrorDescription = {message: "Quest deletion failed or quest did not exist."};
            res.status(HttpStatus.NOT_FOUND).json(response);
            return;
        }
    }));

    /**
     * Delete an objective by ID in the database
     */
    crudController.delete("/:questId/objectives/:objectiveId", verifyAuthorization(authService), asyncHandler(async (req: WinstonRequest, res: Response) => {
        log.info("Admin deleted an objective.", {quest: req.params.questId, objective: req.params.objectiveId, winstonMetadata: req.winstonMetadata});

        if (!questConnector || !updateConnector) {
            log.error("WTF?? Nullability middleware failed!");
            res.sendStatus(HttpStatus.INTERNAL_SERVER_ERROR);
            return;
        }
        if (!req.params.questId || !req.params.objectiveId) {
            log.warn("Quest ID or objective ID is missing.");
            const response: ErrorDescription = {message: "Quest ID or objective ID is missing from request."};
            res.status(HttpStatus.BAD_REQUEST).json(response);
            return;
        }

        const success = await questConnector.deleteObjective(req.params.questId, req.params.objectiveId);

        if (success) {
            const deletionUpdate: GenericDeletion = {
                type: HierarchyLevel.OBJECTIVE,
                id: req.params.questId,
                subId: req.params.objectiveId
            };

            updateConnector.pushRemoval(deletionUpdate);

            res.sendStatus(HttpStatus.ACCEPTED);
            return;
        }
        else {
            log.warn("Deletion from DB failed.");
            const response: ErrorDescription = {message: "Either deletion from DB failed, or quest/objective did not exist"};
            res.status(HttpStatus.NOT_FOUND).json(response);
            return;
        }
    }));

    controllerInitialized = true;
}

export default async function(): Promise<Router> {
    if (!controllerInitialized) await initController();
    return crudController;
}
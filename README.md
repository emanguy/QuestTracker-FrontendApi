# Quest Tracker - Frontend API [![Build Status](https://travis-ci.org/emanguy/QuestTracker-FrontendApi.svg?branch=master)](https://travis-ci.org/emanguy/QuestTracker-FrontendApi)

The frontend API of the quest tracker handles authentication and CRUD operations for the Dungeon Master and serves
the initial list of quests to players.

Additionally, this frontend API server will publish the changes through redis to the [Push Notification Service](https://www.github.com/emanguy/QuestTracker-NotificationService)
so players will receive live quest updates via server push as the DM updates the quest via the admin interface.

## Endpoints

 * `/quests/` - Check [QuestCrudController](src/controllers/QuestCrudController.ts), controls CRUD operations concerning quests and objectives.
 * `/auth/` - Check [AuthController](src/controllers/AuthController.ts), controls login/logout and distribution of auth tokens
 
## Auth strategy

The frontend API utilizes an authentication strategy with salts to increase hash variability and nonces to prevent replay attacks.
No passwords are ever transmitted over the wire. An authentication process goes as follows:

1. An admin enters their username and password, then clicks "login".
2. The client requests the user's password salt as well as a server nonce & nonce ID.
3. The client computes a password hash using the provided salt from the server.
4. The client then hashes the server nonce and a client nonce that it generates within the same string as the password hash to create a unique nonce-hash.
5. The client transmits the nonce-hash to the server along with the server nonce ID and the client nonce.
6. The server accepts the nonce-hash, client nonce, and server nonce ID.
7. The server looks up the server nonce via nonce ID to verify that it actually transmitted it initially, then invalidates it.
8. The server then creates the initial nonce-password hash string and compares it with the nonce-hash transmitted by the client.
9. If the server determines that the client transmitted a correct nonce-hash, it will deliver an auth token to the client to be used for future access to endpoints which require authentication.
The username and auth token are transmitted on these endpoints via the HTTP headers `x-username` and `x-auth-token`.

## Docker environment variables

All environment variables can be set via a `.env` file on the root of this project. See defaults in the [config file](src/config.ts)

* `PROCESS_PORT` - The port to run this server off of.
* `MONGO_HOSTNAME` - The hostname where MongoDB can be found.
* `MONGO_PORT` - The port that MongoDB is serving from.
* `MONGO_DB_NAME` - The database to communicate with.
* `MONGO_DB_USER` - The username to authenticate to Mongo with.
* `MONGO_DB_PASSWORD` - The password to connect to Mongo with.
* `REDIS_CONNECTION_STRING` - The url where redis can be reached, e.g. **redis://localhost:6379**.
* `REDIS_PASSWORD` - The password used to authenticate with redis. 

## Local testing

First, create a `.env` file on the root of this project and enter values for the setting `PROCESS_PORT` as well as any passwords that the software complains about upon running `yarn start`.

Services that the frontend API depends on can be started with docker-compose via `docker-compose up`.

To acquire a login token, the command `yarn run get-auth` can be run. Just be sure to enter your desired testing username and
password in the appropriate spot in [loginAssist.js](loginAssist.js).

Once that's done, you should be able to hit any of the CRUD endpoints under /quests. Sample requests for the quest controller can be found [here](https://documenter.getpostman.com/view/863422/RWgjb2so).
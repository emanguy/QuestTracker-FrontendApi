db.createCollection("quests");
db.quests.createIndex({id: 1});

db.createCollection("users");
db.users.createIndex({username: 1});

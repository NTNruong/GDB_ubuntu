/**
 * Admin CLI for app-managed accounts. Reads USERS_FILE / USER_HOMES_ROOT from
 * the environment (same defaults as the api server) and edits users.json.
 *
 *   node dist/cli/users.js add <username> [password]   (or PASSWORD env)
 *   node dist/cli/users.js remove <username>
 *   node dist/cli/users.js list
 *
 * In production: docker compose exec api node apps/api/dist/cli/users.js add alice 's3cret'
 */
import { readConfig } from "../config.js";
import { addUser, listUsers, removeUser } from "../userStore.js";

async function main(): Promise<void> {
  const config = readConfig();
  const [command, username] = process.argv.slice(2);

  switch (command) {
    case "add": {
      if (!username) {
        throw new Error("usage: users add <username> [password]");
      }
      const password = process.argv[4] ?? process.env.PASSWORD;
      if (!password) {
        throw new Error("provide a password as the 3rd arg or via PASSWORD env");
      }
      await addUser(config.usersFile, username, password);
      console.log(`added user "${username}" (${config.usersFile})`);
      break;
    }
    case "remove": {
      if (!username) {
        throw new Error("usage: users remove <username>");
      }
      await removeUser(config.usersFile, username);
      console.log(`removed user "${username}"`);
      break;
    }
    case "list": {
      const users = await listUsers(config.usersFile);
      if (users.length === 0) {
        console.log("(no users)");
      } else {
        for (const user of users) {
          console.log(`${user.username}\t${user.createdAt}`);
        }
      }
      break;
    }
    default:
      throw new Error("usage: users <add|remove|list> ...");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

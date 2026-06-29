/**
 * Admin CLI for app-managed accounts. Reads USERS_FILE / USER_HOMES_ROOT from
 * the environment (same defaults as the api server) and edits users.json.
 *
 *   node dist/cli/users.js add <username> [password] [--admin]   (or PASSWORD env)
 *   node dist/cli/users.js remove <username>
 *   node dist/cli/users.js list
 *   node dist/cli/users.js role <username> <admin|user>
 *   node dist/cli/users.js approve <username>
 *   node dist/cli/users.js reset <username> [password]           (or PASSWORD env)
 *
 * Bootstrap the first admin after migration: users role <username> admin
 * In production: docker compose exec api node apps/api/dist/cli/users.js add alice 's3cret'
 */
import { readConfig } from "../config.js";
import {
  addUser,
  adminResetPassword,
  approveUser,
  listUsers,
  removeUser,
  setRole
} from "../userStore.js";

async function main(): Promise<void> {
  const config = readConfig();
  const args = process.argv.slice(2);
  const [command, username] = args;
  const isAdmin = args.includes("--admin");
  const positional = args.filter((a) => !a.startsWith("--"));

  switch (command) {
    case "add": {
      if (!username) {
        throw new Error("usage: users add <username> [password] [--admin]");
      }
      const password = positional[2] ?? process.env.PASSWORD;
      if (!password) {
        throw new Error("provide a password as the 3rd arg or via PASSWORD env");
      }
      await addUser(config.usersFile, username, password, {
        role: isAdmin ? "admin" : "user"
      });
      console.log(`added ${isAdmin ? "admin" : "user"} "${username}" (${config.usersFile})`);
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
          const flags = [user.role, user.status, user.totpEnabled ? "2fa" : ""]
            .filter(Boolean)
            .join(",");
          console.log(`${user.username}\t${flags}\t${user.createdAt}`);
        }
      }
      break;
    }
    case "role": {
      const role = positional[2];
      if (!username || (role !== "admin" && role !== "user")) {
        throw new Error("usage: users role <username> <admin|user>");
      }
      await setRole(config.usersFile, username, role);
      console.log(`set "${username}" role=${role}`);
      break;
    }
    case "approve": {
      if (!username) {
        throw new Error("usage: users approve <username>");
      }
      await approveUser(config.usersFile, username);
      console.log(`approved "${username}"`);
      break;
    }
    case "reset": {
      if (!username) {
        throw new Error("usage: users reset <username> [password]");
      }
      const password = positional[2] ?? process.env.PASSWORD;
      if (!password) {
        throw new Error("provide a password as the 3rd arg or via PASSWORD env");
      }
      await adminResetPassword(config.usersFile, username, password);
      console.log(`reset password for "${username}"`);
      break;
    }
    default:
      throw new Error("usage: users <add|remove|list|role|approve|reset> ...");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

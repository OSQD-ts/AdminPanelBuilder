/** Runs the command line when executed: `node dist/apb.js …`. `bin/apb.mjs` is the installed launcher. */
import { main } from "./cli.js";

process.exitCode = await main(process.argv.slice(2));

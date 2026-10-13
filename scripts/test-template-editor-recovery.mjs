import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
const result = spawnSync(process.execPath,["--test","tests/template-editor-recovery.test.mjs"],{
  cwd:fileURLToPath(new URL("..",import.meta.url)),
  env:{...process.env,ENGINE_REQUIRE_BROWSER:"1"},
  stdio:"inherit",
});
if(result.error)console.error(result.error.message);
process.exitCode=result.status??1;

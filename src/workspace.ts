import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { resolve, join, relative, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
export const LESSON = JSON.stringify({
  lesson: 30,
  title: "Approvals in your UI",
  marker: "APPROVAL-30",
});
export async function prepareWorkspace() {
  const parent = resolve(realpathSync.native(tmpdir()), "claude-sdk30");
  const root = resolve(parent, randomUUID()),
    cwd = join(root, "project"),
    home = join(root, "home"),
    sdkHome = join(root, "sdk");
  const r = relative(parent, root);
  if (!r || r.startsWith("..") || isAbsolute(r))
    throw new Error("Invalid classroom workspace.");
  for (const dir of [cwd, home, sdkHome]) await mkdir(dir, { recursive: true });
  await writeFile(join(cwd, "lesson.txt"), LESSON, "utf-8");
  return {
    cwd,
    home,
    sdkHome,
    async inspect() {
      let fileContents: string | null = null;
      try {
        fileContents = await readFile(join(cwd, "result.txt"), "utf-8");
      } catch {}
      const contents = async (name: string) => {
        try {
          return await readFile(join(cwd, name), "utf-8");
        } catch {
          return null;
        }
      };
      return {
        fileCreated: fileContents !== null,
        fileContents,
        reviewedContents: await contents("reviewed.txt"),
        secondContents: await contents("second.txt"),
        fixtureUnchanged:
          (await readFile(join(cwd, "lesson.txt"), "utf-8")) === LESSON,
      };
    },
    async cleanup() {
      const target = resolve(root),
        rel = relative(parent, target);
      if (!rel || rel.startsWith("..") || isAbsolute(rel))
        throw new Error("Refusing cleanup outside run.");
      await rm(target, { recursive: true, force: true });
    },
  };
}

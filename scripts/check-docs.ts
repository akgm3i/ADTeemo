/** Check repository documentation without network access or writes. */
const documentStatuses: Record<string, readonly string[]> = {
  adr: ["accepted", "superseded"],
  proposal: ["proposed", "rejected", "superseded"],
  research: ["current", "historical"],
  integration: ["current", "superseded"],
  user: ["current", "superseded"],
  content: ["current", "superseded"],
  navigation: ["moved"],
};

function prose(source: string): string {
  return source.replace(/^(```|~~~)[\s\S]*?^\1[^\n]*$/gm, "");
}

function links(source: string): string[] {
  return [...prose(source).matchAll(/\[[^\]\n]*\]\(([^\s)]+)\)/g)]
    .map((match) => match[1]);
}

function headings(source: string): Set<string> {
  const counts = new Map<string, number>();
  const result = new Set<string>();
  for (const match of prose(source).matchAll(/^#{1,6}\s+(.+?)\s*#*$/gm)) {
    const base = match[1].toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "")
      .replace(/ /g, "-");
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    result.add(count ? `${base}-${count}` : base);
  }
  return result;
}

async function markdownFiles(directory: URL): Promise<URL[]> {
  const files: URL[] = [];
  for await (const entry of Deno.readDir(directory)) {
    const path = new URL(
      entry.name + (entry.isDirectory ? "/" : ""),
      directory,
    );
    if (entry.isDirectory) files.push(...await markdownFiles(path));
    else if (entry.isFile && entry.name.endsWith(".md")) files.push(path);
  }
  return files;
}

export async function checkDocumentation(root: URL): Promise<string[]> {
  const documents = [
    ...await markdownFiles(new URL("docs/", root)),
    ...await markdownFiles(new URL("messages/", root)),
  ];
  const rootDocuments: URL[] = [];
  for await (const entry of Deno.readDir(root)) {
    if (entry.isFile && entry.name.endsWith(".md")) {
      rootDocuments.push(new URL(entry.name, root));
    }
  }
  const index = new URL("docs/README.md", root);
  const indexSource = await Deno.readTextFile(index);
  const indexed = new Set(
    links(indexSource).filter((link) => !/^[a-z][\w+.-]*:/i.test(link))
      .map((link) => new URL(link.split("#")[0], index).href),
  );
  const failures: string[] = [];
  for (const file of [...documents, ...rootDocuments]) {
    const path = decodeURIComponent(file.href.slice(root.href.length));
    const source = await Deno.readTextFile(file);
    if (documents.includes(file) && file.href !== index.href) {
      if (!indexed.has(file.href)) {
        failures.push(`${path}: index entry missing`);
      }
      const metadata = Object.fromEntries(
        [...source.matchAll(/^- ([A-Za-z ]+): (.+)$/gm)]
          .map((match) => [match[1], match[2]]),
      );
      const statuses = documentStatuses[metadata.Type];
      if (!statuses) failures.push(`${path}: unknown Type ${metadata.Type}`);
      if (!statuses?.includes(metadata.Status)) {
        failures.push(`${path}: unknown Status ${metadata.Status}`);
      }
      if (metadata.Type !== "navigation") {
        for (
          const field of [
            "Summary",
            "Read when",
            "Related",
            "Code",
            "Tests",
            "Reviewed",
            "Verified",
          ]
        ) {
          if (!metadata[field]) failures.push(`${path}: missing ${field}`);
        }
        if (metadata.Type === "research" && !metadata.Observed) {
          failures.push(`${path}: missing Observed`);
        }
      }
    }
    for (const link of links(source)) {
      if (/^[a-z][\w+.-]*:/i.test(link) || link.startsWith("//")) continue;
      const target = new URL(link, file);
      const fragment = decodeURIComponent(target.hash.slice(1));
      target.hash = "";
      try {
        const stat = await Deno.stat(target);
        if (fragment && stat.isFile && target.pathname.endsWith(".md")) {
          if (!headings(await Deno.readTextFile(target)).has(fragment)) {
            failures.push(`${path}: missing heading ${link}`);
          }
        }
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
        failures.push(`${path}: missing link ${link}`);
      }
    }
  }
  return failures;
}

if (import.meta.main) {
  const failures = await checkDocumentation(new URL("../", import.meta.url));
  if (failures.length) {
    console.error(failures.join("\n"));
    Deno.exitCode = 1;
  } else {
    console.log("Documentation index, metadata, and relative links are valid.");
  }
}

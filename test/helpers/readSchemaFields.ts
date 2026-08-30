// Standalone entry point, run via `tsx` in a child process — NOT imported directly by Jest.
//
// Reads the ordered @type()-decorated field names off a Colyseus Schema class, straight from
// its `Symbol.metadata`. Runs as its own process (rather than a plain `import()` inside the
// test) so it can be spawned with `cwd` set to whichever project (backend or frontend) owns the
// target file — decorator legacy-mode (`experimentalDecorators`) is resolved from the nearest
// tsconfig.json to cwd, not from the imported file's own directory, so importing a frontend
// schema file from the backend's cwd silently compiles it with the wrong decorator semantics.
//
// Usage: tsx readSchemaFields.ts <absoluteFilePath> <exportName>   (exportName: 'default' for a default export)
const [, , filePath, exportName] = process.argv;

(async () => {
    const mod = await import(filePath);
    const cls = exportName === 'default' ? mod.default : mod[exportName];
    if (!cls) {
        throw new Error(`Export '${exportName}' not found in ${filePath}`);
    }
    const meta = (cls as any)[Symbol.metadata];
    if (!meta) {
        throw new Error(`No decorator metadata on '${exportName}' in ${filePath} — is it a Colyseus Schema class?`);
    }
    const indices = Object.keys(meta)
        .filter(k => /^\d+$/.test(k))
        .map(Number)
        .sort((a, b) => a - b);
    process.stdout.write(JSON.stringify(indices.map(i => meta[i].name)));
})().catch(err => {
    console.error(err);
    process.exit(1);
});

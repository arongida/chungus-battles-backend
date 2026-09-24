// Standalone entry point, run via `tsx` in a child process — NOT imported directly by Jest.
// Prints `{ [emoteId]: slot }` for the EMOTES export of the given catalog file (backend
// src/social/emotes.ts or the frontend mirror). Same child-process approach as
// readSchemaFields.ts, so the frontend file compiles against its own project settings.
//
// Usage: tsx readEmoteCatalog.ts <absoluteFilePath>
const [, , filePath] = process.argv;

(async () => {
    const mod = await import(filePath);
    const emotes = mod.EMOTES as Record<string, { slot: string }>;
    if (!emotes) throw new Error(`No EMOTES export in ${filePath}`);
    const out: Record<string, string> = {};
    Object.keys(emotes).forEach(id => { out[id] = emotes[id].slot; });
    process.stdout.write(JSON.stringify(out));
})().catch(err => {
    console.error(err);
    process.exit(1);
});

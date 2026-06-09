const url = Deno.args[0] ?? "http://localhost:8000/health";

const response = await fetch(url);
await response.body?.cancel();

if (!response.ok) {
  Deno.exit(1);
}

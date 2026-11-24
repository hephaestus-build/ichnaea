#!/usr/bin/env node
import type { Writable } from "node:stream";
import { StringDecoder } from "node:string_decoder";

import { main } from "../cli.ts";

import { jsonRequested } from "./command-grammar.ts";

const argv = process.argv.slice(2);
const stdout = process.stdout.write.bind(process.stdout);
const stderr = process.stderr.write.bind(process.stderr);

const log = (text: string): void => void stderr(`[plugin] ${text.replace(/\r$/, "")}\n`);

function routeDiagnostics(stream: Writable): () => void {
  const decoder = new StringDecoder("utf8");
  let pending = "";
  const write: typeof stream.write = (
    chunk: string | Uint8Array,
    encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
    callback?: (error?: Error | null) => void,
  ): boolean => {
    const encoding = typeof encodingOrCallback === "string" ? encodingOrCallback : undefined;
    const data = typeof chunk === "string" ? Buffer.from(chunk, encoding) : Buffer.from(chunk);
    const lines = (pending + decoder.write(data)).split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) log(line);
    const done = typeof encodingOrCallback === "function" ? encodingOrCallback : callback;
    if (done) queueMicrotask(done);
    return true;
  };
  stream.write = write;
  return () => {
    pending += decoder.end();
    if (pending) log(pending);
    pending = "";
  };
}

if (jsonRequested(argv)) {
  const endStdout = routeDiagnostics(process.stdout);
  const endStderr = routeDiagnostics(process.stderr);
  process.once("beforeExit", () => {
    endStdout();
    endStderr();
  });
  process.exitCode = await main(
    argv,
    (result) => {
      endStdout();
      endStderr();
      stdout(`${result}\n`);
    },
    undefined,
    (error) => stderr(`${error}\n`),
  );
} else process.exitCode = await main(argv);

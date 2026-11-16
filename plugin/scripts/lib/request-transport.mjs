// @ts-check
// The transport seam: header-only sessions use Node fetch; browser sessions use page.request.
import { playwright, sectionsOf } from "./execution-guard.mjs";
import { headerCredentialValues, injectHeader } from "./header-credential.mjs";
import { errorLine, requestCode, maskResponseBody, MAX_FETCHED, RESPONSE_HEADERS } from "./tester-request.mjs";
import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { AUTH_DIR } from "./execute-auth.mjs";
import { ensurePrivateDir, writeSecretFile } from "./platform-privacy.mjs";

/** @import { ExecutionSession } from "./execution-guard.mjs" */
/** @import { PlatformContext, PlatformRefusal } from "./platform.mjs" */
/** @import { ResolvedHeaderCredential } from "./header-credential.mjs" */
/** @import { PrivacyContext } from "./platform-privacy.mjs" */
/** @import { TesterRequestSuccess } from "./tester-request.mjs" */
/** @typedef {{ missing?: boolean, refused?: boolean, refusal?: PlatformRefusal, error?: string, result?: string, credential_sent?: boolean }} RequestTransportResult */
/** @typedef {{ status: number, headers: Record<string, string>, body: string, cut: boolean }} TransportResponse */
/**
 * Private transport result, with body literals masked before limits.
 * responseOf prepares outward responses; the caller masks transport errors through errorLine.
 * Secret-bearing browser requests use a private code file, never argv.
 * @param {{ execDir: string, session: ExecutionSession, request: TesterRequestSuccess, credential: ResolvedHeaderCredential | null, values?: readonly string[], env?: NodeJS.ProcessEnv, platformContext?: PlatformContext, context?: PrivacyContext }} options
 * @returns {RequestTransportResult | Promise<RequestTransportResult>}
 */
export function requestTransport({ execDir, session, request, credential, values = headerCredentialValues(credential), env, platformContext, context = {} }) {
  if (session.kind === "header-only") return fetchRequest(request, credential, values);
  const code = requestCode({ ...request, headers: injectHeader({ ...request.headers, ...(request.auth && { cookie: "" }) }, credential) }, values);
  let ran;
  if (values.length || credential) {
    const auth = join(dirname(dirname(execDir)), AUTH_DIR);
    const dirCheck = ensurePrivateDir(auth, context, { chmodExisting: false });
    if (!dirCheck.ok) return { refusal: dirCheck.refusal };
    const file = join(auth, `request-${randomUUID()}.js`);
    // Exclusive creation never overwrites another call or follows an existing symlink.
    const written = writeSecretFile(file, code, context);
    if (!written.ok) return { refusal: written.refusal };
    try {
      ran = playwright(execDir, session.name, ["run-code", "--filename", file], env, undefined, platformContext);
    } finally {
      rmSync(file, { force: true });
    }
  } else ran = playwright(execDir, session.name, ["run-code", code], env, undefined, platformContext);
  if (ran.missing) return { missing: true };
  if (ran.refused) return { refused: true, refusal: ran.refusal };
  if (ran.error) return { error: ran.error };
  return { result: sectionsOf(ran.text).find((s) => s.name === "Result")?.body, credential_sent: credential !== null };
}

/**
 * @param {TesterRequestSuccess} request
 * @param {ResolvedHeaderCredential | null} credential
 * @param {readonly string[]} values
 * @returns {Promise<RequestTransportResult>}
 */
async function fetchRequest(request, credential, values) {
  try {
    const response = await fetch(request.href, {
      method: request.method, headers: injectHeader({ ...(request.data !== undefined && { "content-type": "application/json" }), ...request.headers }, credential),
      ...(request.data !== undefined && { body: JSON.stringify(request.data) }),
      redirect: "manual", signal: AbortSignal.timeout(30000),
    });
    const text = await response.text();
    const masked = maskResponseBody(text, values);
    const headers = Object.fromEntries(RESPONSE_HEADERS.flatMap((name) => {
      const value = response.headers.get(name);
      return value === null ? [] : [[name, value]];
    }));
    /** @type {TransportResponse} */
    const result = { status: response.status, headers, body: masked.slice(0, MAX_FETCHED), cut: masked.length > MAX_FETCHED };
    return { result: JSON.stringify(result), credential_sent: credential !== null };
  } catch (error) {
    return { error: errorLine(error instanceof Error ? error.message : String(error), values) };
  }
}

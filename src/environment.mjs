// Credential-bearing controller processes must not pass GitHub tokens to DSH.
export function sanitizedDshEnv(parent = process.env) {
  const env = { ...parent };
  // Windows environment names are case-insensitive; ordinary JavaScript objects are not.
  for (const key of Object.keys(env)) {
    if (['GH_TOKEN', 'GITHUB_TOKEN'].includes(key.toUpperCase())) delete env[key];
  }
  return env;
}
